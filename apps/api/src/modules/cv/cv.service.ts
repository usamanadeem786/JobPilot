import { Injectable, Logger } from '@nestjs/common';
import {
  CV_TEMPLATES,
  CorruptDocumentError,
  CvDocumentSchema,
  EmptyDocumentError,
  MIME_TYPES,
  UnsupportedFileTypeError,
  allSkills,
  detectCvType,
  emptyCvDocument,
  extractCvText,
  getTemplate,
  parseCv,
  renderCvToDocx,
  renderCvToPdf,
  type CvDocument,
} from '@jobpilot/cv';
import {
  CV_UPLOAD_MESSAGES,
  MAX_CV_UPLOAD_BYTES,
  type CreateMasterCvInput,
  type CvUploadResultDto,
  type MasterCvDetailDto,
  type MasterCvSummaryDto,
  type Provenance,
  type UpdateMasterCvInput,
} from '@jobpilot/shared';
import { ScanStatus } from '@jobpilot/database';
import type { FileObject, MasterCV, Prisma } from '@jobpilot/database';
import { AppException } from '../../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface UploadedCvFile {
  readonly originalName: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

type CvWithFile = MasterCV & { sourceFile: FileObject | null };

/** The sections a CV is expected to have, for the "what is missing" report. */
const REPORTED_SECTIONS = ['personal', 'summary', 'skills', 'experience', 'education'] as const;

@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Accepts an uploaded CV, extracts its text, parses it and stores the result.
   *
   * The file type is decided by sniffing the bytes, not by the extension or the
   * browser-supplied Content-Type — both are attacker-controlled, and both are
   * routinely wrong even when they are not.
   *
   * Parsing is deterministic and offline: no LLM sees the document at upload
   * time. What the parser could not find is recorded as NOT_FOUND rather than
   * guessed, and returned to the caller so the gap is visible.
   */
  async upload(userId: string, file: UploadedCvFile): Promise<CvUploadResultDto> {
    if (file.buffer.byteLength === 0) {
      throw AppException.badRequest('VALIDATION_FAILED', CV_UPLOAD_MESSAGES.noFile);
    }
    if (file.buffer.byteLength > MAX_CV_UPLOAD_BYTES) {
      throw AppException.badRequest('FILE_TOO_LARGE', CV_UPLOAD_MESSAGES.tooLarge);
    }

    const detected = detectCvType(file.buffer);
    if (!detected) {
      throw AppException.badRequest('UNSUPPORTED_FILE_TYPE', CV_UPLOAD_MESSAGES.wrongType);
    }

    let text: string;
    let declaredTypeMismatch = false;
    try {
      const extracted = await extractCvText(file.buffer, file.mimeType);
      text = extracted.text;
      declaredTypeMismatch = extracted.declaredTypeMismatch;
    } catch (error) {
      if (error instanceof UnsupportedFileTypeError) {
        throw AppException.badRequest('UNSUPPORTED_FILE_TYPE', CV_UPLOAD_MESSAGES.wrongType);
      }
      if (error instanceof CorruptDocumentError) {
        throw AppException.unprocessable('UNSUPPORTED_FILE_TYPE', error.message);
      }
      if (error instanceof EmptyDocumentError) {
        // Almost always a scanned PDF. Saying so is more useful than "failed",
        // because the fix (OCR it first) is something the user can act on.
        throw AppException.unprocessable('UNSUPPORTED_FILE_TYPE', CV_UPLOAD_MESSAGES.unreadable);
      }
      throw error;
    }

    const parsed = parseCv(text);

    // The blob is written before the row so a failed upload cannot leave a
    // database record pointing at a file that was never stored.
    const stored = await this.storage.put({
      userId,
      content: file.buffer,
      extension: detected,
    });

    const isFirst = (await this.prisma.masterCV.count({ where: { userId } })) === 0;
    const title = deriveTitle(parsed.document, file.originalName);

    try {
      // The file row and the CV row are written together: a CV whose source
      // file is missing, or a file row with no CV pointing at it, are both
      // states nothing downstream expects to see.
      const created = await this.prisma.$transaction(async (tx) => {
        const fileObject = await tx.fileObject.create({
          data: {
            userId,
            driver: this.storage.driver,
            storageKey: stored.storageKey,
            originalName: sanitiseName(file.originalName),
            mimeType: MIME_TYPES[detected],
            sizeBytes: stored.sizeBytes,
            checksumSha256: stored.checksumSha256,
            // No scanner is wired up. Recording SKIPPED states that plainly
            // rather than defaulting to CLEAN, which would assert something
            // nobody checked.
            scanStatus: ScanStatus.SKIPPED,
          },
        });

        return tx.masterCV.create({
          data: {
            userId,
            title,
            isDefault: isFirst,
            rawText: text,
            content: parsed.document as unknown as Prisma.InputJsonValue,
            parseProvenance: parsed.provenance as unknown as Prisma.InputJsonValue,
            parsedAt: new Date(),
            sourceFileId: fileObject.id,
          },
          include: { sourceFile: true },
        });
      });

      const warnings: string[] = [];
      if (parsed.unrecognisedHeadings.length > 0) {
        warnings.push(
          `These headings were not recognised and their content was left out: ${parsed.unrecognisedHeadings.join(', ')}. You can add it by hand.`,
        );
      }
      if (declaredTypeMismatch) {
        // Not an error — the bytes decide, and they were readable. But the user
        // should know the file is not the format its name claims.
        warnings.push(
          `This file is a ${detected.toUpperCase()} even though its name suggests otherwise. It was read as a ${detected.toUpperCase()}.`,
        );
      }

      return {
        cv: toDetail(created),
        missingSections: missingSections(parsed.provenance),
        warnings,
      };
    } catch (error) {
      // The row failed, so the blob is now an orphan. Remove it.
      await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  /** Creates an empty CV for someone who would rather type than upload. */
  async create(userId: string, input: CreateMasterCvInput): Promise<MasterCvDetailDto> {
    const isFirst = (await this.prisma.masterCV.count({ where: { userId } })) === 0;

    const created = await this.prisma.masterCV.create({
      data: {
        userId,
        title: input.title,
        isDefault: isFirst,
        content: emptyCvDocument() as unknown as Prisma.InputJsonValue,
      },
      include: { sourceFile: true },
    });

    return toDetail(created);
  }

  async list(userId: string): Promise<MasterCvSummaryDto[]> {
    const rows = await this.prisma.masterCV.findMany({
      where: { userId },
      include: { sourceFile: true },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });

    return rows.map(toSummary);
  }

  async get(userId: string, id: string): Promise<MasterCvDetailDto> {
    return toDetail(await this.require(userId, id));
  }

  /**
   * Saves an edit.
   *
   * The document is re-validated against the schema on every save: the editor
   * autosaves, so this endpoint is the only thing standing between a UI bug and
   * a malformed CV in the database that later breaks rendering.
   */
  async update(userId: string, id: string, input: UpdateMasterCvInput): Promise<MasterCvDetailDto> {
    const existing = await this.require(userId, id);

    const data: Prisma.MasterCVUpdateInput = {};

    if (input.title !== undefined) data.title = input.title;

    if (input.content !== undefined) {
      const result = CvDocumentSchema.safeParse(input.content);
      if (!result.success) {
        throw AppException.badRequest(
          'VALIDATION_FAILED',
          'That CV could not be saved because some fields are not valid.',
          result.error.issues.map((issue) => ({
            path: issue.path.join('.') || 'content',
            message: issue.message,
          })),
        );
      }
      data.content = result.data as unknown as Prisma.InputJsonValue;
      data.version = { increment: 1 };
    }

    if (Object.keys(data).length === 0) return toDetail(existing);

    const updated = await this.prisma.masterCV.update({
      where: { id: existing.id },
      data,
      include: { sourceFile: true },
    });

    return toDetail(updated);
  }

  /**
   * Makes one CV the default, in a transaction.
   *
   * Clearing and setting must not be separable: a failure between them would
   * leave the user with no default at all, and the tailoring flow reads it.
   */
  async setDefault(userId: string, id: string): Promise<MasterCvSummaryDto[]> {
    const target = await this.require(userId, id);

    await this.prisma.$transaction([
      this.prisma.masterCV.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.masterCV.update({ where: { id: target.id }, data: { isDefault: true } }),
    ]);

    return this.list(userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.require(userId, id);

    await this.prisma.masterCV.delete({ where: { id: existing.id } });

    if (existing.sourceFile) {
      await this.prisma.fileObject.delete({ where: { id: existing.sourceFile.id } }).catch(() => {
        // The CV is gone, which is what the user asked for. A leftover file row
        // is a cleanup problem, not a reason to report failure.
      });
      await this.storage.remove(existing.sourceFile.storageKey);
    }

    // Deleting the default leaves the account without one; promote the newest
    // remaining CV so the tailoring flow always has something to work from.
    if (existing.isDefault) {
      const next = await this.prisma.masterCV.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (next) {
        await this.prisma.masterCV.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
  }

  /** Renders the stored CV to PDF or DOCX for download. */
  async render(
    userId: string,
    id: string,
    format: 'pdf' | 'docx',
    templateKey: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const cv = await this.require(userId, id);

    const parsedDocument = CvDocumentSchema.safeParse(cv.content);
    if (!parsedDocument.success) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        'This CV cannot be rendered until the invalid fields are corrected.',
      );
    }

    // getTemplate falls back to the default for an unknown key. Silently
    // rendering a different design than the one asked for is worse than
    // saying the key is wrong, so the key is checked before it is used.
    if (!CV_TEMPLATES.some((candidate) => candidate.key === templateKey)) {
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        `Unknown template "${templateKey}". Available: ${CV_TEMPLATES.map((t) => t.key).join(', ')}.`,
      );
    }
    const template = getTemplate(templateKey);

    const base = filenameStem(parsedDocument.data.personal.fullName || cv.title);

    if (format === 'docx') {
      return {
        buffer: await renderCvToDocx(parsedDocument.data, { templateKey: template.key }),
        filename: `${base}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }

    return {
      buffer: await renderCvToPdf(parsedDocument.data, { templateKey: template.key }),
      filename: `${base}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  /** Returns the original uploaded file. */
  async downloadSource(
    userId: string,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const cv = await this.require(userId, id);
    if (!cv.sourceFile) {
      throw AppException.notFound('NOT_FOUND', 'This CV was typed in, so there is no original file.');
    }

    return {
      buffer: await this.storage.get(cv.sourceFile.storageKey),
      filename: cv.sourceFile.originalName,
      mimeType: cv.sourceFile.mimeType,
    };
  }

  /**
   * Loads a CV that belongs to this user.
   *
   * Ownership is part of the lookup rather than a check afterwards, so no
   * future caller can forget it. A CV belonging to someone else reports
   * NOT_FOUND, not FORBIDDEN — "forbidden" would confirm the id exists.
   */
  private async require(userId: string, id: string): Promise<CvWithFile> {
    const cv = await this.prisma.masterCV.findFirst({
      where: { id, userId },
      include: { sourceFile: true },
    });

    if (!cv) throw AppException.notFound('NOT_FOUND', 'That CV could not be found.');
    return cv;
  }
}

function documentOf(row: MasterCV): CvDocument {
  const parsed = CvDocumentSchema.safeParse(row.content);
  // A row that fails validation is still shown rather than hidden behind an
  // error: the user can fix it in the editor, but only if they can open it.
  return parsed.success ? parsed.data : emptyCvDocument();
}

function toSummary(row: CvWithFile): MasterCvSummaryDto {
  const document = documentOf(row);

  return {
    id: row.id,
    title: row.title,
    isDefault: row.isDefault,
    fullName: document.personal.fullName,
    headline: document.personal.headline ?? null,
    experienceCount: document.experience.length,
    skillCount: allSkills(document).length,
    sourceFile: row.sourceFile
      ? {
          id: row.sourceFile.id,
          originalName: row.sourceFile.originalName,
          mimeType: row.sourceFile.mimeType,
          sizeBytes: row.sourceFile.sizeBytes,
          scanStatus: row.sourceFile.scanStatus,
          uploadedAt: row.sourceFile.createdAt.toISOString(),
        }
      : null,
    parsedAt: row.parsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: CvWithFile): MasterCvDetailDto {
  return {
    ...toSummary(row),
    content: documentOf(row),
    rawText: row.rawText,
    parseProvenance: (row.parseProvenance as Record<string, Provenance> | null) ?? null,
  };
}

function missingSections(provenance: Record<string, Provenance>): string[] {
  return REPORTED_SECTIONS.filter((section) => provenance[section] === 'NOT_FOUND');
}

/**
 * Names the CV after the person it describes, falling back to the filename.
 *
 * "Usama Nadeem — CV" is easier to pick out of a list than "cv_final_v3.pdf".
 */
function deriveTitle(document: CvDocument, originalName: string): string {
  const name = document.personal.fullName.trim();
  if (name) return `${name} — CV`;

  const stem = originalName.replace(/\.[^.]+$/, '').trim();
  return stem.slice(0, 160) || 'Untitled CV';
}

/** Strips path segments and control characters from a user-supplied filename. */
function sanitiseName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'upload';
}

function filenameStem(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'cv'
  );
}
