import { Inject, Injectable, Logger } from '@nestjs/common';
import { CvDocumentSchema, getTemplate, renderCvToDocx, renderCvToPdf } from '@jobpilot/cv';
import { CvFabricationError, type CvTailoringService as AiTailoringService } from '@jobpilot/ai';
import { AiProviderNotConfiguredError, AiResponseInvalidError } from '@jobpilot/ai';
import type {
  CvChangeSummaryDto,
  TailoredCvDetailDto,
  TailoredCvSummaryDto,
} from '@jobpilot/shared';
import type { Prisma } from '@jobpilot/database';
import { AppException } from '../../common/errors/app-exception';
import { CV_TAILORING_SERVICE } from '../ai/ai.module';
import { PrismaService } from '../prisma/prisma.service';

type TailoredRow = Prisma.TailoredCVGetPayload<{
  include: { job: { select: { title: true; companyName: true } } };
}>;

/**
 * Produces a CV rewritten for one job.
 *
 * The master CV is never modified. A tailored version is a separate row tied
 * to the job, so the user always has their own record of their history intact
 * and can see exactly what was changed for each application.
 *
 * The anti-fabrication check lives in the AI package and runs before anything
 * is stored. A result that invents an employer, a date or a qualification is
 * discarded rather than saved with a warning — a CV a user might send to an
 * employer is not a place for "probably fine".
 */
@Injectable()
export class CvTailoringService {
  private readonly logger = new Logger(CvTailoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CV_TAILORING_SERVICE) private readonly tailoring: AiTailoringService,
  ) {}

  async generate(userId: string, jobId: string): Promise<TailoredCvDetailDto> {
    const userJob = await this.prisma.userJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
      include: { job: { select: { title: true, companyName: true, description: true } } },
    });

    if (!userJob) throw AppException.notFound('NOT_FOUND', 'That job could not be found.');

    const master = await this.prisma.masterCV.findFirst({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, content: true },
    });

    if (!master) {
      throw AppException.badRequest(
        'VALIDATION_FAILED',
        'Upload a CV first — tailoring rewrites your existing one for this role.',
      );
    }

    const parsedMaster = CvDocumentSchema.safeParse(master.content);
    if (!parsedMaster.success) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        'Your CV has invalid fields, so it cannot be tailored yet. Open it and correct them.',
      );
    }

    // Versions accumulate rather than overwrite: a user who regenerates should
    // still be able to see what was sent with an application made yesterday.
    const previous = await this.prisma.tailoredCV.findFirst({
      where: { userId, jobId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (previous?.version ?? 0) + 1;

    try {
      const result = await this.tailoring.tailor({
        cv: parsedMaster.data,
        jobTitle: userJob.job.title,
        companyName: userJob.job.companyName,
        jobDescription: userJob.job.description,
      });

      const created = await this.prisma.tailoredCV.create({
        data: {
          userId,
          jobId,
          masterCvId: master.id,
          version,
          // DRAFT, not FINAL: it is generated output the user should read and
          // edit before it goes to an employer.
          status: 'DRAFT',
          content: result.document as unknown as Prisma.InputJsonValue,
          changeSummary: result.changeSummary as unknown as Prisma.InputJsonValue,
          generationMeta: {
            model: result.model,
            promptVersion: result.promptVersion,
            generatedAt: result.generatedAt,
          } as unknown as Prisma.InputJsonValue,
        },
        include: { job: { select: { title: true, companyName: true } } },
      });

      // The job's status moves on only from an earlier stage. Someone who has
      // already applied should not be dragged back to "CV generated" because
      // they regenerated the document.
      await this.prisma.userJob.updateMany({
        where: { userId, jobId, status: { in: ['NEW', 'SHORTLISTED'] } },
        data: { status: 'CV_GENERATED' },
      });

      return toDetail(created);
    } catch (error) {
      if (error instanceof AiProviderNotConfiguredError) {
        throw AppException.serviceUnavailable(
          'AI_PROVIDER_NOT_CONFIGURED',
          'No AI provider is configured on this deployment, so CVs cannot be tailored yet.',
        );
      }

      if (error instanceof AiResponseInvalidError) {
        // The model replied with something that is not a CV. Nothing is
        // stored: a half-parsed document is not a safer outcome than none.
        this.logger.warn(`Tailoring for job ${jobId} returned an unusable response.`);
        throw AppException.unprocessable(
          'AI_RESPONSE_INVALID',
          'The AI returned a CV we could not verify, so nothing was saved. Try again.',
        );
      }

      if (error instanceof CvFabricationError) {
        // Recorded, not silently dropped: a provider that repeatedly invents
        // content is a fact worth being able to see.
        await this.prisma.tailoredCV.create({
          data: {
            userId,
            jobId,
            masterCvId: master.id,
            version,
            status: 'FAILED',
            content: parsedMaster.data as unknown as Prisma.InputJsonValue,
            failureReason: error.message,
          },
        });

        this.logger.warn(
          `Tailoring for job ${jobId} was discarded: ${error.findings.length} fabricated item(s).`,
        );

        throw AppException.unprocessable(
          'AI_RESPONSE_INVALID',
          `${error.message} Nothing was saved. Try again, or edit your master CV to include the missing detail.`,
        );
      }

      throw error;
    }
  }

  async list(userId: string): Promise<TailoredCvSummaryDto[]> {
    const rows = await this.prisma.tailoredCV.findMany({
      where: { userId },
      include: { job: { select: { title: true, companyName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toSummary);
  }

  async get(userId: string, id: string): Promise<TailoredCvDetailDto> {
    return toDetail(await this.require(userId, id));
  }

  /** Renders a tailored CV for download. */
  async render(
    userId: string,
    id: string,
    format: 'pdf' | 'docx',
    templateKey: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const row = await this.require(userId, id);

    const parsed = CvDocumentSchema.safeParse(row.content);
    if (!parsed.success) {
      throw AppException.unprocessable(
        'VALIDATION_FAILED',
        'This tailored CV cannot be rendered — its stored contents are not valid.',
      );
    }

    const template = getTemplate(templateKey);
    const stem = filenameStem(
      `${parsed.data.personal.fullName || 'CV'} ${row.job.companyName}`,
    );

    if (format === 'docx') {
      return {
        buffer: await renderCvToDocx(parsed.data, { templateKey: template.key }),
        filename: `${stem}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }

    return {
      buffer: await renderCvToPdf(parsed.data, { templateKey: template.key }),
      filename: `${stem}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  private async require(userId: string, id: string): Promise<TailoredRow> {
    const row = await this.prisma.tailoredCV.findFirst({
      where: { id, userId },
      include: { job: { select: { title: true, companyName: true } } },
    });

    if (!row) throw AppException.notFound('NOT_FOUND', 'That tailored CV could not be found.');
    return row;
  }
}

function toSummary(row: TailoredRow): TailoredCvSummaryDto {
  return {
    id: row.id,
    jobId: row.jobId,
    jobTitle: row.job.title,
    companyName: row.job.companyName,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: TailoredRow): TailoredCvDetailDto {
  const meta = (row.generationMeta ?? null) as { model?: string; promptVersion?: string } | null;

  return {
    ...toSummary(row),
    content: row.content,
    changeSummary: (row.changeSummary as CvChangeSummaryDto | null) ?? null,
    failureReason: row.failureReason,
    model: meta?.model ?? null,
    promptVersion: meta?.promptVersion ?? null,
  };
}

function filenameStem(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'tailored-cv'
  );
}
