import { z } from 'zod';
import { ApplicationMethod, ApplicationStatus, ApplyMethod } from './enums';
import type { ApplicationEventType } from './enums';

/**
 * Application tracking.
 *
 * The status machine is defined here rather than left to the UI, because the
 * same rules have to hold for a bulk action, a single edit and an external
 * sync. A pipeline where any status can become any other is not a pipeline —
 * it is a free-text field with a dropdown.
 */

/**
 * Which transitions are allowed from each status.
 *
 * Terminal states are deliberately not fully closed: a rejection can be
 * reopened, because companies do re-engage candidates and a tracker that
 * cannot record that forces the user to lie to it. What is not allowed is
 * moving backwards into DRAFT once something has actually been sent — that
 * would quietly erase the fact that an application exists.
 */
export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ['READY', 'SUBMITTED', 'WITHDRAWN'],
  READY: ['DRAFT', 'SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN'],
  ACKNOWLEDGED: ['INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN'],
  INTERVIEW: ['INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN'],
  REJECTED: ['INTERVIEW', 'OFFER'],
  OFFER: ['ACKNOWLEDGED', 'REJECTED', 'WITHDRAWN'],
  WITHDRAWN: [],
};

/** Statuses that mean the application has actually reached the employer. */
export const SUBMITTED_STATUSES: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'ACKNOWLEDGED',
  'INTERVIEW',
  'REJECTED',
  'OFFER',
];

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function describeInvalidTransition(from: ApplicationStatus, to: ApplicationStatus): string {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (allowed.length === 0) {
    return `A withdrawn application cannot be changed. Create a new application instead.`;
  }
  return `An application cannot move from ${from} to ${to}. Allowed: ${allowed.join(', ')}.`;
}

export const CreateApplicationSchema = z.object({
  jobId: z.string().uuid(),
  tailoredCvId: z.string().uuid().optional(),
  coverLetter: z.string().trim().max(20_000).optional(),
  method: z.nativeEnum(ApplicationMethod).default(ApplicationMethod.MANUAL),
  notes: z.string().trim().max(5_000).optional(),
});
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>;

export const UpdateApplicationSchema = z.object({
  status: z.nativeEnum(ApplicationStatus).optional(),
  appliedAt: z.string().datetime().nullable().optional(),
  interviewAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
  tailoredCvId: z.string().uuid().nullable().optional(),
});
export type UpdateApplicationInput = z.infer<typeof UpdateApplicationSchema>;

export interface ApplicationEventDto {
  readonly id: string;
  readonly type: ApplicationEventType;
  readonly detail: string;
  readonly occurredAt: string;
}

export interface ApplicationDto {
  readonly id: string;
  readonly jobId: string;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly status: ApplicationStatus;
  readonly method: ApplicationMethod;
  readonly applicationUrl: string;
  readonly tailoredCvId: string | null;
  readonly hasCoverLetter: boolean;
  readonly appliedAt: string | null;
  readonly interviewAt: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly events: ApplicationEventDto[];
}

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready to send',
  SUBMITTED: 'Submitted',
  ACKNOWLEDGED: 'Acknowledged',
  INTERVIEW: 'Interview',
  REJECTED: 'Rejected',
  OFFER: 'Offer',
  WITHDRAWN: 'Withdrawn',
};

/**
 * Whether this job may be applied to programmatically.
 *
 * Two independent conditions, both required. One is about the platform — did
 * the source declare that its terms permit it — and the other is about this
 * deployment's own policy. Either alone is not enough, so a mis-set config
 * flag cannot by itself start submitting applications to a site that forbids
 * it, and neither can a source adapter that overstates its permissions.
 */
export interface AutomationDecision {
  readonly permitted: boolean;
  readonly reason: string;
  /** What the UI should offer instead when automation is not permitted. */
  readonly fallback: 'open-official-page' | 'assisted' | null;
}

export function decideAutomation(input: {
  readonly applyMethod: ApplyMethod;
  readonly sourceSupportsAutomation: boolean;
  readonly deploymentAllowsAutomation: boolean;
}): AutomationDecision {
  // The platform is checked FIRST so the reason given is the truthful one.
  // Telling someone automation is "disabled for this deployment" on a job
  // whose platform forbids it regardless implies that flipping a setting
  // would help. It would not.
  if (!input.sourceSupportsAutomation || input.applyMethod !== ApplyMethod.PERMITTED_API) {
    return {
      permitted: false,
      reason:
        'This platform does not permit automated applications. Use “Apply manually” to open the official application page.',
      fallback: 'open-official-page',
    };
  }

  // Only reached when the platform would allow it, which is the one case
  // where the deployment's own policy is the deciding factor.
  if (!input.deploymentAllowsAutomation) {
    return {
      permitted: false,
      reason: 'Automated applications are disabled for this deployment.',
      fallback: 'assisted',
    };
  }

  return { permitted: true, reason: 'This platform permits programmatic applications.', fallback: null };
}

/**
 * Ranks jobs for the "Latest Jobs" view.
 *
 * Only jobs whose SOURCE published a posting date are eligible. A job found
 * today from a board that publishes no dates is not a new job — it is a job
 * we happened to see today, and presenting it as "latest" is a claim the data
 * does not support.
 */
export function selectLatestJobs<T extends { postedAt: string | null; postedAtKnown: boolean }>(
  jobs: readonly T[],
  limit = 30,
): { readonly items: T[]; readonly excludedForUnknownDate: number } {
  const eligible = jobs.filter((job) => job.postedAtKnown && job.postedAt !== null);

  const sorted = [...eligible].sort(
    (left, right) => Date.parse(right.postedAt as string) - Date.parse(left.postedAt as string),
  );

  return {
    items: sorted.slice(0, limit),
    excludedForUnknownDate: jobs.length - eligible.length,
  };
}
