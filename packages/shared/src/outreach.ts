import { z } from 'zod';
import { OutreachChannel } from './enums';
import type { OutreachStatus } from './enums';

/**
 * Outreach.
 *
 * The rule the brief set — "do NOT automatically spam people" — is implemented
 * as a state machine with no path from DRAFT to SENT. A message becomes
 * sendable only by passing through APPROVED, and approval requires a human
 * action that records who approved it and when.
 *
 * There is deliberately no bulk-send. Selecting 25 jobs generates 25 drafts;
 * each still has to be read and approved individually. That friction is the
 * feature.
 */

export const ALLOWED_OUTREACH_TRANSITIONS: Record<OutreachStatus, readonly OutreachStatus[]> = {
  DRAFT: ['APPROVED', 'CLOSED'],
  // Approval is revocable right up until the message leaves.
  APPROVED: ['DRAFT', 'SENT', 'CLOSED'],
  SENT: ['RESPONDED', 'BOUNCED', 'FOLLOW_UP_DUE', 'CLOSED'],
  RESPONDED: ['CLOSED', 'FOLLOW_UP_DUE'],
  BOUNCED: ['CLOSED'],
  FOLLOW_UP_DUE: ['SENT', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionOutreach(from: OutreachStatus, to: OutreachStatus): boolean {
  if (from === to) return true;
  return ALLOWED_OUTREACH_TRANSITIONS[from].includes(to);
}

export interface OutreachApproval {
  readonly approvedByUserId: string;
  readonly approvedAt: string;
  /** The exact text approved, so an edit after approval is detectable. */
  readonly approvedBodyHash: string;
}

export interface SendDecision {
  readonly canSend: boolean;
  readonly reason: string;
}

/**
 * Whether a draft may be sent.
 *
 * Every condition is checked independently and the first failure is reported,
 * so the caller never has to infer why. The body-hash check is the subtle one:
 * approving a message and then editing it before sending would otherwise let
 * unreviewed text go out under a recorded approval.
 */
export function decideSend(input: {
  readonly status: OutreachStatus;
  readonly approval: OutreachApproval | null;
  readonly currentBodyHash: string;
  readonly recipientEmail: string | null;
  readonly transportConfigured: boolean;
  readonly requireManualApproval: boolean;
}): SendDecision {
  if (!input.transportConfigured) {
    return { canSend: false, reason: 'Email sending is not configured on this deployment.' };
  }

  if (!input.recipientEmail) {
    return {
      canSend: false,
      reason: 'This contact has no verified email address, so there is nowhere to send it.',
    };
  }

  // The deployment-level switch cannot be turned off to skip approval. It
  // exists to make approval mandatory, never optional.
  if (!input.requireManualApproval) {
    return {
      canSend: false,
      reason:
        'Manual approval cannot be disabled. Every outreach message must be reviewed by a person before sending.',
    };
  }

  if (input.status !== 'APPROVED') {
    return {
      canSend: false,
      reason: 'This message must be reviewed and approved before it can be sent.',
    };
  }

  if (!input.approval) {
    return { canSend: false, reason: 'No approval is recorded for this message.' };
  }

  if (input.approval.approvedBodyHash !== input.currentBodyHash) {
    return {
      canSend: false,
      reason: 'The message was edited after it was approved. Review and approve it again.',
    };
  }

  return { canSend: true, reason: 'Approved and ready to send.' };
}

export const GenerateOutreachSchema = z.object({
  contactId: z.string().uuid(),
  jobId: z.string().uuid(),
  channel: z.nativeEnum(OutreachChannel).default(OutreachChannel.EMAIL),
  tone: z.enum(['professional', 'warm', 'brief']).default('professional'),
});
export type GenerateOutreachInput = z.infer<typeof GenerateOutreachSchema>;

export const UpdateOutreachSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
});
export type UpdateOutreachInput = z.infer<typeof UpdateOutreachSchema>;

export interface OutreachDraftDto {
  readonly id: string;
  readonly contactId: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly jobId: string;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly channel: OutreachChannel;
  readonly status: OutreachStatus;
  readonly subject: string;
  readonly body: string;
  readonly approvedAt: string | null;
  readonly sentAt: string | null;
  readonly respondedAt: string | null;
  readonly followUpDueAt: string | null;
  readonly createdAt: string;
}

export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  SENT: 'Sent',
  RESPONDED: 'Responded',
  BOUNCED: 'Bounced',
  FOLLOW_UP_DUE: 'Follow-up due',
  CLOSED: 'Closed',
};
