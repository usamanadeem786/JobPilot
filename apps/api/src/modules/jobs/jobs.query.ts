import { JobStatus, type JobListQuery, type JobSortField } from '@jobpilot/shared';
import type { Prisma } from '@jobpilot/database';

/**
 * Translates the shared list query into Prisma arguments.
 *
 * Kept apart from the service so the translation can be tested on its own.
 * The filters are the part most likely to go quietly wrong — a `where` clause
 * that silently matches everything looks exactly like one that works, and only
 * a test that inspects the generated shape catches it.
 *
 * The query runs against `UserJob`, not `Job`. Postings are shared and
 * deduplicated across accounts; the per-user status, score, note and favourite
 * live on the join. Querying from the user's side is also what makes it
 * impossible to return a posting the user has not discovered.
 */

/**
 * Sortable fields that live on the posting rather than the user's copy of it,
 * and whether each one is nullable.
 *
 * The nullability is not decoration. Prisma accepts the `{ sort, nulls }`
 * form only for nullable columns and rejects the whole query for the rest —
 * `discoveredAt` has a default and is never null, so asking for "nulls last"
 * on it fails at runtime with "Expected SortOrder, provided Object".
 */
const JOB_SORT_FIELDS: Record<string, { field: string; nullable: boolean }> = {
  postedAt: { field: 'postedAt', nullable: true },
  salaryMax: { field: 'salaryMax', nullable: true },
  discoveredAt: { field: 'discoveredAt', nullable: false },
  title: { field: 'title', nullable: false },
  companyName: { field: 'companyName', nullable: false },
};

export function buildJobWhere(userId: string, query: JobListQuery): Prisma.UserJobWhereInput {
  const job: Prisma.JobWhereInput = {};
  const where: Prisma.UserJobWhereInput = { userId, job };

  if (query.search) {
    // `mode: 'insensitive'` rather than lowercasing both sides: it lets
    // Postgres use the trigram indexes, which a function on the column would
    // prevent.
    job.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { companyName: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  if (query.status?.length) where.status = { in: query.status };
  if (query.source?.length) job.source = { key: { in: [...query.source] } };
  if (query.remoteType?.length) job.remoteType = { in: query.remoteType };
  if (query.employmentType?.length) job.employmentType = { in: query.employmentType };
  if (query.experienceLevel?.length) job.experienceLevel = { in: query.experienceLevel };

  if (query.company) job.companyName = { contains: query.company, mode: 'insensitive' };
  if (query.location) job.location = { contains: query.location, mode: 'insensitive' };

  // Compared against the maximum, not the minimum: a role advertised at
  // "up to 90k" should not be hidden from someone asking for 80k+ merely
  // because its floor was never published.
  if (query.minSalary !== undefined) job.salaryMax = { gte: query.minSalary };

  if (query.minRelevance !== undefined) where.relevanceScore = { gte: query.minRelevance };

  if (query.postedWithinDays !== undefined) {
    const cutoff = new Date(Date.now() - query.postedWithinDays * 24 * 60 * 60 * 1000);
    // `postedAtKnown` guards the filter. Without it, a posting whose date the
    // source never published would be judged by its discovery date and
    // presented as recent — a claim the data does not support.
    job.postedAtKnown = true;
    job.postedAt = { gte: cutoff };
  }

  if (query.hasContact === true) job.recruiterEmail = { not: null };
  if (query.favouriteOnly === true) where.isFavorite = true;

  if (!query.includeArchived) {
    where.archivedAt = null;
    where.status = where.status
      ? // An explicit status filter wins, minus ARCHIVED, which the archive
        // flag governs on its own.
        { in: (query.status ?? []).filter((status) => status !== JobStatus.ARCHIVED) }
      : { not: JobStatus.ARCHIVED };
  }

  return where;
}

/**
 * Builds the sort, always with a tiebreaker.
 *
 * Every sortable column has duplicates — dozens of jobs share a company name,
 * and an unscored job's relevance is null for all of them. Without a unique
 * final key, Postgres may order ties differently between two queries, and a
 * row then appears on both page 1 and page 2 while another is never shown at
 * all.
 */
export function buildJobOrderBy(
  sortBy: JobSortField,
  sortOrder: 'asc' | 'desc',
): Prisma.UserJobOrderByWithRelationInput[] {
  const jobField = JOB_SORT_FIELDS[sortBy];

  if (jobField) {
    return [
      {
        job: {
          // Nulls last in both directions: a job whose source published no
          // date is not the newest thing in the list, nor the oldest.
          [jobField.field]: jobField.nullable ? { sort: sortOrder, nulls: 'last' } : sortOrder,
        },
      },
      { jobId: 'asc' },
    ] as Prisma.UserJobOrderByWithRelationInput[];
  }

  if (sortBy === 'relevanceScore') {
    return [{ relevanceScore: { sort: sortOrder, nulls: 'last' } }, { jobId: 'asc' }];
  }

  return [{ status: sortOrder }, { jobId: 'asc' }];
}
