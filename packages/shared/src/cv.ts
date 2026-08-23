import { z } from 'zod';
import type { Provenance, ScanStatus } from './enums';

/**
 * The CV API contract.
 *
 * The structured document itself lives in `@jobpilot/cv` (CvDocumentSchema),
 * which the API validates against. It is deliberately not duplicated here:
 * the web app imports the same package, so there is one definition of what a
 * CV is rather than two that drift.
 */

export const MAX_CV_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_CV_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const UpdateMasterCvSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  /**
   * The edited document. Validated against CvDocumentSchema by the API rather
   * than here, so this package stays free of the CV package's dependencies.
   */
  content: z.unknown().optional(),
});
export type UpdateMasterCvInput = z.infer<typeof UpdateMasterCvSchema>;

export const CreateMasterCvSchema = z.object({
  title: z.string().trim().min(1).max(160).default('Untitled CV'),
});
export type CreateMasterCvInput = z.infer<typeof CreateMasterCvSchema>;

export interface CvSourceFileDto {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** SKIPPED when no scanner is configured — shown, never implied as clean. */
  readonly scanStatus: ScanStatus;
  readonly uploadedAt: string;
}

/** A row in the CV list. Excludes the document body, which is large. */
export interface MasterCvSummaryDto {
  readonly id: string;
  readonly title: string;
  readonly isDefault: boolean;
  readonly fullName: string;
  readonly headline: string | null;
  readonly experienceCount: number;
  readonly skillCount: number;
  readonly sourceFile: CvSourceFileDto | null;
  readonly parsedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MasterCvDetailDto extends MasterCvSummaryDto {
  /** The structured CvDocument. Typed as unknown here; see the note above. */
  readonly content: unknown;
  readonly rawText: string | null;
  /**
   * Per-section record of what was read from the document versus absent, so
   * the editor can say "we could not find this" rather than showing an empty
   * box the user reads as a bug.
   */
  readonly parseProvenance: Record<string, Provenance> | null;
}

export interface CvUploadResultDto {
  readonly cv: MasterCvDetailDto;
  /**
   * Sections the parser could not find. Surfaced immediately after upload so
   * the gap is visible while the user is still looking at the document.
   */
  readonly missingSections: string[];
  readonly warnings: string[];
}

export interface CvTemplateDto {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
}

/** Human copy for the upload failures a user can actually act on. */
export const CV_UPLOAD_MESSAGES = {
  tooLarge: `That file is larger than ${Math.round(MAX_CV_UPLOAD_BYTES / 1024 / 1024)} MB.`,
  wrongType: 'Only PDF and DOCX files are supported.',
  unreadable:
    'No text could be read from that file. If it is a scan, it needs OCR before it can be parsed.',
  noFile: 'Choose a file to upload.',
} as const;
