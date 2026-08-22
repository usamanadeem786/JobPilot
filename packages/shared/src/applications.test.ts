import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  decideAutomation,
  describeInvalidTransition,
  selectLatestJobs,
  SUBMITTED_STATUSES,
} from './applications';
import { ApplyMethod } from './enums';

describe('application status machine', () => {
  it('allows the normal path through the pipeline', () => {
    expect(canTransition('DRAFT', 'READY')).toBe(true);
    expect(canTransition('READY', 'SUBMITTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'INTERVIEW')).toBe(true);
    expect(canTransition('INTERVIEW', 'OFFER')).toBe(true);
  });

  it('refuses to move a sent application back to draft', () => {
    // Doing so would quietly erase the fact that an application exists.
    expect(canTransition('SUBMITTED', 'DRAFT')).toBe(false);
    expect(canTransition('INTERVIEW', 'READY')).toBe(false);
  });

  it('lets a rejection be reopened, because companies do re-engage', () => {
    expect(canTransition('REJECTED', 'INTERVIEW')).toBe(true);
    expect(canTransition('REJECTED', 'OFFER')).toBe(true);
  });

  it('treats withdrawn as final', () => {
    expect(ALLOWED_TRANSITIONS.WITHDRAWN).toEqual([]);
    expect(canTransition('WITHDRAWN', 'SUBMITTED')).toBe(false);
    expect(describeInvalidTransition('WITHDRAWN', 'SUBMITTED')).toContain('cannot be changed');
  });

  it('treats a no-op as allowed, so a form resubmit is not an error', () => {
    expect(canTransition('INTERVIEW', 'INTERVIEW')).toBe(true);
  });

  it('explains a rejected transition with the allowed options', () => {
    const message = describeInvalidTransition('SUBMITTED', 'DRAFT');
    expect(message).toContain('SUBMITTED to DRAFT');
    expect(message).toContain('ACKNOWLEDGED');
  });

  it('counts every status that means the employer has it', () => {
    expect(SUBMITTED_STATUSES).not.toContain('DRAFT');
    expect(SUBMITTED_STATUSES).not.toContain('READY');
    expect(SUBMITTED_STATUSES).toContain('SUBMITTED');
    expect(SUBMITTED_STATUSES).toContain('REJECTED');
  });
});

describe('decideAutomation', () => {
  it('permits automation only when the platform and the deployment both allow it', () => {
    expect(
      decideAutomation({
        applyMethod: ApplyMethod.PERMITTED_API,
        sourceSupportsAutomation: true,
        deploymentAllowsAutomation: true,
      }).permitted,
    ).toBe(true);
  });

  it('refuses when the platform does not permit it, however the deployment is configured', () => {
    const decision = decideAutomation({
      applyMethod: ApplyMethod.EXTERNAL_URL,
      sourceSupportsAutomation: false,
      deploymentAllowsAutomation: true,
    });

    expect(decision.permitted).toBe(false);
    expect(decision.reason).toContain('does not permit automated applications');
    expect(decision.fallback).toBe('open-official-page');
  });

  it('refuses when the deployment disallows it, however permissive the platform', () => {
    const decision = decideAutomation({
      applyMethod: ApplyMethod.PERMITTED_API,
      sourceSupportsAutomation: true,
      deploymentAllowsAutomation: false,
    });

    expect(decision.permitted).toBe(false);
    expect(decision.fallback).toBe('assisted');
  });

  it('refuses a source that claims automation but is not on a permitted apply method', () => {
    // Guards against an adapter overstating its permissions: the apply method
    // has to agree, not just the capability flag.
    expect(
      decideAutomation({
        applyMethod: ApplyMethod.EXTERNAL_URL,
        sourceSupportsAutomation: true,
        deploymentAllowsAutomation: true,
      }).permitted,
    ).toBe(false);
  });

  it('refuses a MANUAL_ONLY job outright', () => {
    expect(
      decideAutomation({
        applyMethod: ApplyMethod.MANUAL_ONLY,
        sourceSupportsAutomation: true,
        deploymentAllowsAutomation: true,
      }).permitted,
    ).toBe(false);
  });

  it('always offers a fallback when it refuses, so the user is never stuck', () => {
    for (const applyMethod of [ApplyMethod.EXTERNAL_URL, ApplyMethod.MANUAL_ONLY]) {
      const decision = decideAutomation({
        applyMethod,
        sourceSupportsAutomation: false,
        deploymentAllowsAutomation: true,
      });
      expect(decision.permitted).toBe(false);
      expect(decision.fallback).not.toBeNull();
    }
  });
});

describe('selectLatestJobs', () => {
  const job = (id: string, postedAt: string | null) => ({
    id,
    postedAt,
    postedAtKnown: postedAt !== null,
  });

  it('orders by posting date, newest first', () => {
    const result = selectLatestJobs([
      job('old', '2026-01-01T00:00:00Z'),
      job('new', '2026-08-01T00:00:00Z'),
      job('mid', '2026-04-01T00:00:00Z'),
    ]);

    expect(result.items.map((entry) => entry.id)).toEqual(['new', 'mid', 'old']);
  });

  it('excludes jobs whose source published no date', () => {
    // A job found today from a dateless board is not a new job — it is a job
    // we happened to see today, and calling it "latest" is unsupported.
    const result = selectLatestJobs([job('dated', '2026-08-01T00:00:00Z'), job('undated', null)]);

    expect(result.items.map((entry) => entry.id)).toEqual(['dated']);
    expect(result.excludedForUnknownDate).toBe(1);
  });

  it('reports how many were excluded, so the UI can say why', () => {
    const result = selectLatestJobs([job('a', null), job('b', null), job('c', '2026-08-01T00:00:00Z')]);
    expect(result.excludedForUnknownDate).toBe(2);
  });

  it('respects the limit', () => {
    const jobs = Array.from({ length: 50 }, (_, index) =>
      job(String(index), new Date(2026, 0, index + 1).toISOString()),
    );
    expect(selectLatestJobs(jobs, 30).items).toHaveLength(30);
  });

  it('returns nothing when no source publishes dates', () => {
    const result = selectLatestJobs([job('a', null), job('b', null)]);
    expect(result.items).toEqual([]);
    expect(result.excludedForUnknownDate).toBe(2);
  });

  it('ignores postedAt when postedAtKnown is false', () => {
    // Defends against a caller that sets a date without the flag; the flag is
    // the authority on whether the source actually published one.
    const result = selectLatestJobs([{ postedAt: '2026-08-01T00:00:00Z', postedAtKnown: false }]);
    expect(result.items).toEqual([]);
  });
});
