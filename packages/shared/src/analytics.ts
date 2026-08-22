import type { ApplicationStatus, JobStatus } from './enums';
import { SUBMITTED_STATUSES } from './applications';

/**
 * Dashboard analytics.
 *
 * Computed here as pure functions rather than in SQL, for two reasons: the
 * same numbers are needed by the API, the export and the tests, and a metric
 * whose definition lives in a query string is a metric nobody can check.
 *
 * Every rate returns null rather than zero when there is nothing to divide by.
 * A response rate of "0%" on a day with no applications is a claim about
 * performance; "no data yet" is the truth.
 */

export interface AnalyticsSummary {
  readonly totalJobs: number;
  readonly newJobs: number;
  readonly shortlisted: number;
  readonly cvsGenerated: number;
  readonly applications: number;
  readonly interviews: number;
  readonly offers: number;
  readonly rejections: number;
  /** Interviews ÷ applications. Null when nothing has been applied to. */
  readonly interviewRate: number | null;
  /** Offers ÷ interviews. Null when there have been no interviews. */
  readonly offerRate: number | null;
}

export interface JobLike {
  readonly status: JobStatus;
  readonly discoveredAt: string;
  readonly postedAt: string | null;
  readonly postedAtKnown: boolean;
  readonly relevanceScore: number | null;
  readonly source: string;
  readonly hasTailoredCv: boolean;
}

export interface ApplicationLike {
  readonly status: ApplicationStatus;
  readonly createdAt: string;
  readonly appliedAt: string | null;
}

export function summarise(
  jobs: readonly JobLike[],
  applications: readonly ApplicationLike[],
): AnalyticsSummary {
  const countJobs = (status: JobStatus): number => jobs.filter((job) => job.status === status).length;
  const countApplications = (status: ApplicationStatus): number =>
    applications.filter((application) => application.status === status).length;

  // Counted from the pipeline rather than the current status: an application
  // that reached interview and was then rejected still happened, and a funnel
  // that forgets it understates what the user achieved.
  const submitted = applications.filter((application) =>
    SUBMITTED_STATUSES.includes(application.status),
  ).length;

  const interviews = applications.filter((application) =>
    (['INTERVIEW', 'OFFER'] as ApplicationStatus[]).includes(application.status),
  ).length;

  const offers = countApplications('OFFER');

  return {
    totalJobs: jobs.length,
    newJobs: countJobs('NEW'),
    shortlisted: countJobs('SHORTLISTED'),
    cvsGenerated: jobs.filter((job) => job.hasTailoredCv).length,
    applications: submitted,
    interviews,
    offers,
    rejections: countApplications('REJECTED'),
    interviewRate: submitted > 0 ? interviews / submitted : null,
    offerRate: interviews > 0 ? offers / interviews : null,
  };
}

export interface TimeSeriesPoint {
  /** ISO date, no time component. */
  readonly date: string;
  readonly count: number;
}

/**
 * Daily counts across a date range.
 *
 * Every day in the range is present, including the empty ones. A chart drawn
 * from only the days that had activity compresses the gaps and makes a quiet
 * fortnight look like steady progress.
 */
export function toDailySeries(
  timestamps: readonly (string | null)[],
  options: { readonly days: number; readonly today?: Date },
): TimeSeriesPoint[] {
  const end = startOfUtcDay(options.today ?? new Date());
  const buckets = new Map<string, number>();

  for (let offset = options.days - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - offset);
    buckets.set(isoDate(date), 0);
  }

  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const parsed = Date.parse(timestamp);
    if (Number.isNaN(parsed)) continue;

    const key = isoDate(startOfUtcDay(new Date(parsed)));
    const existing = buckets.get(key);
    if (existing !== undefined) buckets.set(key, existing + 1);
  }

  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface DistributionBucket {
  readonly label: string;
  readonly count: number;
}

/**
 * Match scores grouped into bands.
 *
 * Ten-point buckets would imply the scores are precise to ten points. They are
 * an estimate, so the bands are wide enough to be honest about that, and jobs
 * with no score are counted separately rather than dropped — how many are
 * unanalysed is itself information.
 */
export function scoreDistribution(jobs: readonly JobLike[]): {
  readonly buckets: DistributionBucket[];
  readonly unscored: number;
} {
  const bands: readonly { readonly label: string; readonly min: number; readonly max: number }[] = [
    { label: '0–24', min: 0, max: 24 },
    { label: '25–44', min: 25, max: 44 },
    { label: '45–64', min: 45, max: 64 },
    { label: '65–79', min: 65, max: 79 },
    { label: '80–100', min: 80, max: 100 },
  ];

  const scored = jobs.filter((job) => job.relevanceScore !== null);

  return {
    buckets: bands.map((band) => ({
      label: band.label,
      count: scored.filter(
        (job) => (job.relevanceScore as number) >= band.min && (job.relevanceScore as number) <= band.max,
      ).length,
    })),
    unscored: jobs.length - scored.length,
  };
}

/** Jobs per source, largest first. */
export function bySource(jobs: readonly JobLike[]): DistributionBucket[] {
  const counts = new Map<string, number>();
  for (const job of jobs) counts.set(job.source, (counts.get(job.source) ?? 0) + 1);

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count);
}

/** Applications per status, in pipeline order rather than alphabetically. */
export function applicationFunnel(applications: readonly ApplicationLike[]): DistributionBucket[] {
  const order: readonly ApplicationStatus[] = [
    'DRAFT',
    'READY',
    'SUBMITTED',
    'ACKNOWLEDGED',
    'INTERVIEW',
    'OFFER',
    'REJECTED',
    'WITHDRAWN',
  ];

  return order
    .map((status) => ({
      label: status,
      count: applications.filter((application) => application.status === status).length,
    }))
    .filter((bucket) => bucket.count > 0);
}

/**
 * Formats a rate for display, distinguishing "none yet" from "zero".
 *
 * The difference matters: 0% says every application failed, and "—" says
 * there is nothing to measure.
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}
