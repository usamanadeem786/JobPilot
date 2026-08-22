import { describe, expect, it } from 'vitest';
import {
  applicationFunnel,
  bySource,
  formatRate,
  scoreDistribution,
  summarise,
  toDailySeries,
  type ApplicationLike,
  type JobLike,
} from './analytics';

function job(overrides: Partial<JobLike> = {}): JobLike {
  return {
    status: 'NEW',
    discoveredAt: '2026-08-20T10:00:00Z',
    postedAt: '2026-08-19T10:00:00Z',
    postedAtKnown: true,
    relevanceScore: 70,
    source: 'greenhouse',
    hasTailoredCv: false,
    ...overrides,
  };
}

function application(overrides: Partial<ApplicationLike> = {}): ApplicationLike {
  return { status: 'SUBMITTED', createdAt: '2026-08-20T10:00:00Z', appliedAt: '2026-08-20T10:00:00Z', ...overrides };
}

describe('summarise', () => {
  it('counts jobs by status', () => {
    const result = summarise(
      [job({ status: 'NEW' }), job({ status: 'NEW' }), job({ status: 'SHORTLISTED' })],
      [],
    );

    expect(result.totalJobs).toBe(3);
    expect(result.newJobs).toBe(2);
    expect(result.shortlisted).toBe(1);
  });

  it('counts an interview that later became a rejection', () => {
    // A funnel that forgets it understates what the user achieved.
    const result = summarise([], [application({ status: 'REJECTED' }), application({ status: 'INTERVIEW' })]);
    expect(result.applications).toBe(2);
    expect(result.interviews).toBe(1);
    expect(result.rejections).toBe(1);
  });

  it('counts an offer as an interview too, since it passed through one', () => {
    const result = summarise([], [application({ status: 'OFFER' })]);
    expect(result.interviews).toBe(1);
    expect(result.offers).toBe(1);
  });

  it('excludes drafts from the application count', () => {
    // A draft has not reached the employer, so counting it would overstate.
    const result = summarise([], [application({ status: 'DRAFT' }), application({ status: 'READY' })]);
    expect(result.applications).toBe(0);
  });

  it('returns null rather than zero for a rate with no denominator', () => {
    // "0%" is a claim about performance; null means there is nothing to measure.
    const result = summarise([], []);
    expect(result.interviewRate).toBeNull();
    expect(result.offerRate).toBeNull();
  });

  it('computes rates when there is something to divide by', () => {
    const result = summarise([], [
      application({ status: 'SUBMITTED' }),
      application({ status: 'SUBMITTED' }),
      application({ status: 'INTERVIEW' }),
      application({ status: 'OFFER' }),
    ]);

    expect(result.applications).toBe(4);
    expect(result.interviewRate).toBeCloseTo(0.5);
    expect(result.offerRate).toBeCloseTo(0.5);
  });
});

describe('toDailySeries', () => {
  const today = new Date('2026-08-22T15:00:00Z');

  it('includes every day in the range, even empty ones', () => {
    // A chart drawn only from active days compresses the gaps and makes a
    // quiet fortnight look like steady progress.
    const series = toDailySeries(['2026-08-22T09:00:00Z'], { days: 7, today });
    expect(series).toHaveLength(7);
    expect(series.filter((point) => point.count === 0)).toHaveLength(6);
  });

  it('buckets by UTC day', () => {
    const series = toDailySeries(['2026-08-21T23:59:00Z', '2026-08-22T00:01:00Z'], { days: 3, today });
    expect(series.find((point) => point.date === '2026-08-21')?.count).toBe(1);
    expect(series.find((point) => point.date === '2026-08-22')?.count).toBe(1);
  });

  it('ignores nulls and unparseable timestamps', () => {
    const series = toDailySeries([null, 'not a date', '2026-08-22T09:00:00Z'], { days: 3, today });
    expect(series.reduce((total, point) => total + point.count, 0)).toBe(1);
  });

  it('drops timestamps outside the window rather than clamping them', () => {
    // Clamping would pile a year of history onto the first visible day.
    const series = toDailySeries(['2020-01-01T00:00:00Z'], { days: 7, today });
    expect(series.reduce((total, point) => total + point.count, 0)).toBe(0);
  });

  it('ends on today', () => {
    const series = toDailySeries([], { days: 3, today });
    expect(series.at(-1)?.date).toBe('2026-08-22');
  });
});

describe('scoreDistribution', () => {
  it('bands scores rather than implying ten-point precision', () => {
    const result = scoreDistribution([
      job({ relevanceScore: 10 }),
      job({ relevanceScore: 50 }),
      job({ relevanceScore: 85 }),
      job({ relevanceScore: 90 }),
    ]);

    expect(result.buckets.find((b) => b.label === '0–24')?.count).toBe(1);
    expect(result.buckets.find((b) => b.label === '45–64')?.count).toBe(1);
    expect(result.buckets.find((b) => b.label === '80–100')?.count).toBe(2);
  });

  it('counts unscored jobs separately rather than dropping them', () => {
    // How many are unanalysed is itself information.
    const result = scoreDistribution([job({ relevanceScore: null }), job({ relevanceScore: 70 })]);
    expect(result.unscored).toBe(1);
  });

  it('includes the band boundaries', () => {
    expect(scoreDistribution([job({ relevanceScore: 0 })]).buckets[0]?.count).toBe(1);
    expect(scoreDistribution([job({ relevanceScore: 100 })]).buckets.at(-1)?.count).toBe(1);
  });
});

describe('bySource', () => {
  it('orders sources by volume', () => {
    const result = bySource([
      job({ source: 'lever' }),
      job({ source: 'greenhouse' }),
      job({ source: 'greenhouse' }),
    ]);

    expect(result[0]).toEqual({ label: 'greenhouse', count: 2 });
    expect(result[1]).toEqual({ label: 'lever', count: 1 });
  });
});

describe('applicationFunnel', () => {
  it('returns statuses in pipeline order, not alphabetically', () => {
    const result = applicationFunnel([
      application({ status: 'OFFER' }),
      application({ status: 'DRAFT' }),
      application({ status: 'INTERVIEW' }),
    ]);

    expect(result.map((bucket) => bucket.label)).toEqual(['DRAFT', 'INTERVIEW', 'OFFER']);
  });

  it('omits empty stages', () => {
    expect(applicationFunnel([application({ status: 'SUBMITTED' })])).toHaveLength(1);
  });
});

describe('formatRate', () => {
  it('distinguishes no data from zero', () => {
    // 0% says every application failed; "—" says there is nothing to measure.
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0)).toBe('0%');
  });

  it('rounds to whole percentages', () => {
    expect(formatRate(0.333)).toBe('33%');
  });
});
