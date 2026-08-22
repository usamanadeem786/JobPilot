import { z } from 'zod';
import {
  EmploymentType,
  ExperienceLevel,
  JobStatus,
  RemoteType,
  SalaryPeriod,
} from './enums';
import type { Provenance } from './enums';
import { PaginationQuerySchema, SortOrderSchema } from './pagination';

/**
 * The jobs list contract.
 *
 * Shared so the table's filters, the API's query validation and the CSV export
 * all agree on one definition. A filter the client can express but the server
 * cannot parse is the classic way this drifts.
 */

export const JOB_SORT_FIELDS = [
  'relevanceScore',
  'postedAt',
  'discoveredAt',
  'title',
  'companyName',
  'salaryMax',
  'status',
] as const;

export const JobSortFieldSchema = z.enum(JOB_SORT_FIELDS);
export type JobSortField = z.infer<typeof JobSortFieldSchema>;

/** Coerces `?status=NEW&status=APPLIED` and `?status=NEW,APPLIED` alike. */
const CommaSeparated = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value;
    return String(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }, z.array(inner).optional());

export const JobListQuerySchema = PaginationQuerySchema.extend({
  /** Free text across title, company and description. */
  search: z.string().trim().max(200).optional(),
  status: CommaSeparated(z.nativeEnum(JobStatus)),
  source: CommaSeparated(z.string().trim().min(1).max(40)),
  remoteType: CommaSeparated(z.nativeEnum(RemoteType)),
  employmentType: CommaSeparated(z.nativeEnum(EmploymentType)),
  experienceLevel: CommaSeparated(z.nativeEnum(ExperienceLevel)),
  company: z.string().trim().max(160).optional(),
  location: z.string().trim().max(160).optional(),
  minSalary: z.coerce.number().int().min(0).max(100_000_000).optional(),
  minRelevance: z.coerce.number().int().min(0).max(100).optional(),
  /** Only jobs whose source published a real posting date. */
  postedWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  hasContact: z.coerce.boolean().optional(),
  favouriteOnly: z.coerce.boolean().optional(),
  includeArchived: z.coerce.boolean().default(false),
  sortBy: JobSortFieldSchema.default('discoveredAt'),
  sortOrder: SortOrderSchema.default('desc'),
});

export type JobListQuery = z.infer<typeof JobListQuerySchema>;

export interface JobSalaryDto {
  readonly min: number | null;
  readonly max: number | null;
  readonly currency: string | null;
  readonly period: SalaryPeriod;
}

export interface JobContactDto {
  readonly name: string | null;
  readonly title: string | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly confidence: number | null;
  /** Never VERIFIED unless a second permitted source confirmed it. */
  readonly provenance: Provenance;
}

/**
 * A row in the jobs table.
 *
 * Flattens the canonical `Job` and the per-user `UserJob` into the single
 * object the brief specified, so the client is unaware of the split that keeps
 * postings deduplicated across users.
 */
export interface JobListItemDto {
  readonly id: string;
  readonly source: string;
  readonly sourceDisplayName: string;
  readonly externalJobId: string;
  readonly title: string;
  readonly companyName: string;
  readonly companyWebsite: string | null;
  readonly companyLogo: string | null;
  readonly location: string | null;
  readonly remoteType: RemoteType;
  readonly employmentType: EmploymentType;
  readonly experienceLevel: ExperienceLevel;
  readonly salary: JobSalaryDto | null;
  readonly jobUrl: string;
  readonly applicationUrl: string;
  /** Null when the source published no date. Never a guess. */
  readonly postedAt: string | null;
  readonly postedAtKnown: boolean;
  readonly discoveredAt: string;
  readonly status: JobStatus;
  readonly relevanceScore: number | null;
  readonly isFavourite: boolean;
  readonly hasTailoredCv: boolean;
  readonly applicationId: string | null;
  readonly contact: JobContactDto | null;
  readonly notes: string | null;
}

export interface JobDetailDto extends JobListItemDto {
  readonly description: string;
  readonly analysis: JobAnalysisDto | null;
}

export interface JobAnalysisDto {
  readonly score: number;
  readonly matchingSkills: string[];
  readonly missingSkills: string[];
  readonly matchingExperience: string[];
  readonly missingExperience: string[];
  readonly recommendation: string;
  readonly reason: string;
  /** AI_INFERENCE for anything an LLM produced. Never presented as fact. */
  readonly provenance: Provenance;
  readonly promptVersion: string;
  readonly analysedAt: string;
}

/** Bulk actions the table can apply to a selection. */
export const JOB_BULK_ACTIONS = [
  'set-status',
  'archive',
  'unarchive',
  'favourite',
  'unfavourite',
  'generate-cv',
  'delete',
] as const;

export const JobBulkActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set-status'),
    jobIds: z.array(z.string().uuid()).min(1).max(200),
    status: z.nativeEnum(JobStatus),
  }),
  z.object({
    action: z.enum(['archive', 'unarchive', 'favourite', 'unfavourite', 'generate-cv', 'delete']),
    jobIds: z.array(z.string().uuid()).min(1).max(200),
  }),
]);

export type JobBulkAction = z.infer<typeof JobBulkActionSchema>;

export const UpdateJobSchema = z.object({
  status: z.nativeEnum(JobStatus).optional(),
  isFavourite: z.boolean().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;

/** Human labels, shared so the table, filters and export never disagree. */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  NEW: 'New',
  SHORTLISTED: 'Shortlisted',
  CV_GENERATED: 'CV generated',
  APPLIED: 'Applied',
  INTERVIEW: 'Interview',
  REJECTED: 'Rejected',
  OFFER: 'Offer',
  ARCHIVED: 'Archived',
};

export const REMOTE_TYPE_LABELS: Record<RemoteType, string> = {
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
  ONSITE: 'On-site',
  UNKNOWN: 'Not stated',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
  INTERNSHIP: 'Internship',
  FREELANCE: 'Freelance',
  UNKNOWN: 'Not stated',
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  INTERNSHIP: 'Internship',
  ENTRY: 'Entry',
  JUNIOR: 'Junior',
  MID: 'Mid',
  SENIOR: 'Senior',
  LEAD: 'Lead',
  PRINCIPAL: 'Principal',
  EXECUTIVE: 'Executive',
  UNKNOWN: 'Not stated',
};

/**
 * Formats a salary range for display, returning null rather than a partial
 * figure. "From $120,000" for a range whose maximum is unknown reads as a
 * complete fact and is not one.
 */
export function formatSalary(salary: JobSalaryDto | null): string | null {
  if (!salary || (salary.min === null && salary.max === null)) return null;

  const currency = salary.currency ?? 'USD';
  const format = (value: number): string => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${currency} ${value.toLocaleString()}`;
    }
  };

  const period =
    salary.period === SalaryPeriod.UNKNOWN
      ? ''
      : ` / ${salary.period.toLowerCase().replace('ly', '').replace('dai', 'day')}`;

  if (salary.min !== null && salary.max !== null) {
    return `${format(salary.min)} – ${format(salary.max)}${period}`;
  }

  return `${format((salary.min ?? salary.max) as number)}+${period}`;
}
