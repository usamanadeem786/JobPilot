/**
 * Domain enums mirrored from the Prisma schema.
 *
 * The web app must not depend on `@prisma/client` (it would drag the query
 * engine into the browser bundle), so the values are declared here and the
 * API asserts at build time that the two stay in sync — see
 * `apps/api/src/common/enum-parity.test.ts`.
 */

export const Role = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const RemoteType = {
  REMOTE: 'REMOTE',
  HYBRID: 'HYBRID',
  ONSITE: 'ONSITE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type RemoteType = (typeof RemoteType)[keyof typeof RemoteType];

export const EmploymentType = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACT',
  TEMPORARY: 'TEMPORARY',
  INTERNSHIP: 'INTERNSHIP',
  FREELANCE: 'FREELANCE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type EmploymentType = (typeof EmploymentType)[keyof typeof EmploymentType];

export const ExperienceLevel = {
  INTERNSHIP: 'INTERNSHIP',
  ENTRY: 'ENTRY',
  JUNIOR: 'JUNIOR',
  MID: 'MID',
  SENIOR: 'SENIOR',
  LEAD: 'LEAD',
  PRINCIPAL: 'PRINCIPAL',
  EXECUTIVE: 'EXECUTIVE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ExperienceLevel = (typeof ExperienceLevel)[keyof typeof ExperienceLevel];

export const SalaryPeriod = {
  HOURLY: 'HOURLY',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
  UNKNOWN: 'UNKNOWN',
} as const;
export type SalaryPeriod = (typeof SalaryPeriod)[keyof typeof SalaryPeriod];

export const JobStatus = {
  NEW: 'NEW',
  SHORTLISTED: 'SHORTLISTED',
  CV_GENERATED: 'CV_GENERATED',
  APPLIED: 'APPLIED',
  INTERVIEW: 'INTERVIEW',
  REJECTED: 'REJECTED',
  OFFER: 'OFFER',
  ARCHIVED: 'ARCHIVED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  SUBMITTED: 'SUBMITTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  INTERVIEW: 'INTERVIEW',
  REJECTED: 'REJECTED',
  OFFER: 'OFFER',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const ApplicationMethod = {
  MANUAL: 'MANUAL',
  ASSISTED: 'ASSISTED',
  AUTOMATED: 'AUTOMATED',
} as const;
export type ApplicationMethod = (typeof ApplicationMethod)[keyof typeof ApplicationMethod];

export const ApplicationEventType = {
  CREATED: 'CREATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  CV_ATTACHED: 'CV_ATTACHED',
  COVER_LETTER_ATTACHED: 'COVER_LETTER_ATTACHED',
  SUBMITTED: 'SUBMITTED',
  NOTE_ADDED: 'NOTE_ADDED',
  INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED',
  EXTERNAL_UPDATE: 'EXTERNAL_UPDATE',
  ERROR: 'ERROR',
} as const;
export type ApplicationEventType =
  (typeof ApplicationEventType)[keyof typeof ApplicationEventType];

export const JobSourceKind = {
  ATS_BOARD: 'ATS_BOARD',
  AGGREGATOR_API: 'AGGREGATOR_API',
  PARTNER_API: 'PARTNER_API',
  CAREER_FEED: 'CAREER_FEED',
  MANUAL_IMPORT: 'MANUAL_IMPORT',
} as const;
export type JobSourceKind = (typeof JobSourceKind)[keyof typeof JobSourceKind];

export const JobSourceHealth = {
  UNKNOWN: 'UNKNOWN',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
} as const;
export type JobSourceHealth = (typeof JobSourceHealth)[keyof typeof JobSourceHealth];

export const ApplyMethod = {
  EXTERNAL_URL: 'EXTERNAL_URL',
  PERMITTED_API: 'PERMITTED_API',
  MANUAL_ONLY: 'MANUAL_ONLY',
} as const;
export type ApplyMethod = (typeof ApplyMethod)[keyof typeof ApplyMethod];

export const SearchStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type SearchStatus = (typeof SearchStatus)[keyof typeof SearchStatus];

/**
 * Truth level of a stored value. The UI renders a different badge for each,
 * so an AI guess can never be mistaken for a confirmed fact.
 */
export const Provenance = {
  KNOWN: 'KNOWN',
  VERIFIED: 'VERIFIED',
  AI_INFERENCE: 'AI_INFERENCE',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type Provenance = (typeof Provenance)[keyof typeof Provenance];

export const ContactRole = {
  RECRUITER: 'RECRUITER',
  TALENT_ACQUISITION: 'TALENT_ACQUISITION',
  HR: 'HR',
  HIRING_MANAGER: 'HIRING_MANAGER',
  ENGINEERING_MANAGER: 'ENGINEERING_MANAGER',
  CTO: 'CTO',
  CEO: 'CEO',
  FOUNDER: 'FOUNDER',
  OTHER: 'OTHER',
} as const;
export type ContactRole = (typeof ContactRole)[keyof typeof ContactRole];

export const OutreachChannel = {
  EMAIL: 'EMAIL',
  LINKEDIN_MESSAGE: 'LINKEDIN_MESSAGE',
  CONTACT_FORM: 'CONTACT_FORM',
  OTHER: 'OTHER',
} as const;
export type OutreachChannel = (typeof OutreachChannel)[keyof typeof OutreachChannel];

export const OutreachStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  SENT: 'SENT',
  RESPONDED: 'RESPONDED',
  BOUNCED: 'BOUNCED',
  FOLLOW_UP_DUE: 'FOLLOW_UP_DUE',
  CLOSED: 'CLOSED',
} as const;
export type OutreachStatus = (typeof OutreachStatus)[keyof typeof OutreachStatus];

export const TailoredCvStatus = {
  GENERATING: 'GENERATING',
  DRAFT: 'DRAFT',
  EDITED: 'EDITED',
  FINAL: 'FINAL',
  FAILED: 'FAILED',
} as const;
export type TailoredCvStatus = (typeof TailoredCvStatus)[keyof typeof TailoredCvStatus];

export const StorageDriver = {
  LOCAL: 'LOCAL',
  S3: 'S3',
} as const;
export type StorageDriver = (typeof StorageDriver)[keyof typeof StorageDriver];

export const ScanStatus = {
  PENDING: 'PENDING',
  CLEAN: 'CLEAN',
  INFECTED: 'INFECTED',
  SKIPPED: 'SKIPPED',
  ERROR: 'ERROR',
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const MatchRecommendation = {
  STRONG_MATCH: 'STRONG_MATCH',
  GOOD_MATCH: 'GOOD_MATCH',
  POSSIBLE_MATCH: 'POSSIBLE_MATCH',
  WEAK_MATCH: 'WEAK_MATCH',
  NOT_RECOMMENDED: 'NOT_RECOMMENDED',
} as const;
export type MatchRecommendation = (typeof MatchRecommendation)[keyof typeof MatchRecommendation];

/** Every enum keyed by name, used by the parity test against Prisma. */
export const DOMAIN_ENUMS = {
  Role,
  UserStatus,
  RemoteType,
  EmploymentType,
  ExperienceLevel,
  SalaryPeriod,
  JobStatus,
  ApplicationStatus,
  ApplicationMethod,
  ApplicationEventType,
  JobSourceKind,
  JobSourceHealth,
  ApplyMethod,
  SearchStatus,
  Provenance,
  ContactRole,
  OutreachChannel,
  OutreachStatus,
  TailoredCvStatus,
  StorageDriver,
  ScanStatus,
  MatchRecommendation,
} as const;
