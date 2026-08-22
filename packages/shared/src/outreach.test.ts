import { describe, expect, it } from 'vitest';
import { ALLOWED_OUTREACH_TRANSITIONS, canTransitionOutreach, decideSend } from './outreach';

const base = {
  status: 'APPROVED' as const,
  approval: {
    approvedByUserId: 'user-1',
    approvedAt: '2026-08-22T10:00:00Z',
    approvedBodyHash: 'hash-1',
  },
  currentBodyHash: 'hash-1',
  recipientEmail: 'recruiter@example.com',
  transportConfigured: true,
  requireManualApproval: true,
};

describe('outreach state machine', () => {
  it('has no path from draft straight to sent', () => {
    // The whole anti-spam design rests on this: sending requires passing
    // through an explicit human approval.
    expect(canTransitionOutreach('DRAFT', 'SENT')).toBe(false);
    expect(ALLOWED_OUTREACH_TRANSITIONS.DRAFT).not.toContain('SENT');
  });

  it('allows draft to approved to sent', () => {
    expect(canTransitionOutreach('DRAFT', 'APPROVED')).toBe(true);
    expect(canTransitionOutreach('APPROVED', 'SENT')).toBe(true);
  });

  it('lets approval be revoked before sending', () => {
    expect(canTransitionOutreach('APPROVED', 'DRAFT')).toBe(true);
  });

  it('does not allow a sent message to return to draft', () => {
    expect(canTransitionOutreach('SENT', 'DRAFT')).toBe(false);
    expect(canTransitionOutreach('SENT', 'APPROVED')).toBe(false);
  });

  it('treats closed as final', () => {
    expect(ALLOWED_OUTREACH_TRANSITIONS.CLOSED).toEqual([]);
  });
});

describe('decideSend', () => {
  it('permits a properly approved, unedited message', () => {
    expect(decideSend(base)).toMatchObject({ canSend: true });
  });

  it('refuses a draft that was never approved', () => {
    const decision = decideSend({ ...base, status: 'DRAFT', approval: null });
    expect(decision.canSend).toBe(false);
    expect(decision.reason).toContain('reviewed and approved');
  });

  it('refuses when the body changed after approval', () => {
    // Otherwise approving a polite note and then editing it would let
    // unreviewed text go out under a recorded approval.
    const decision = decideSend({ ...base, currentBodyHash: 'hash-2' });
    expect(decision.canSend).toBe(false);
    expect(decision.reason).toContain('edited after it was approved');
  });

  it('refuses when approval is missing despite the status', () => {
    expect(decideSend({ ...base, approval: null }).canSend).toBe(false);
  });

  it('refuses when there is no verified address to send to', () => {
    const decision = decideSend({ ...base, recipientEmail: null });
    expect(decision.canSend).toBe(false);
    expect(decision.reason).toContain('no verified email address');
  });

  it('refuses when no transport is configured', () => {
    expect(decideSend({ ...base, transportConfigured: false }).canSend).toBe(false);
  });

  it('cannot be bypassed by disabling the approval requirement', () => {
    // The switch exists to make approval mandatory, never optional. Turning
    // it off must not become a way to send unreviewed mail.
    const decision = decideSend({ ...base, requireManualApproval: false });
    expect(decision.canSend).toBe(false);
    expect(decision.reason).toContain('cannot be disabled');
  });

  it('reports exactly one reason, so the caller never has to infer', () => {
    const decision = decideSend({
      ...base,
      status: 'DRAFT',
      approval: null,
      recipientEmail: null,
      transportConfigured: false,
    });
    expect(decision.reason).toContain('not configured');
  });
});
