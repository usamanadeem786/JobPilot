import type { JobListQuery } from '@jobpilot/shared';

/**
 * Serialises the jobs query into a search string.
 *
 * Empty values and false flags are omitted so the URL stays readable and two
 * equivalent queries produce the same cache key — otherwise `status=` and no
 * status at all would be different entries in the query cache.
 *
 * Lives outside the page component because Next.js only permits a fixed set of
 * named exports from a route file.
 */
export function toSearchParams(query: JobListQuery): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
      continue;
    }

    if (typeof value === 'boolean' && !value) continue;
    params.set(key, String(value));
  }

  return params.toString();
}

/**
 * Whether the user has narrowed the list at all.
 *
 * Drives the difference between "you have no jobs yet, run a search" and
 * "your filters exclude everything, clear them". One empty table, two causes,
 * and pointing at the wrong remedy makes the product look broken: telling
 * someone with 400 stored jobs to go and search for more, because a status
 * filter matched nothing, is not a helpful thing to say.
 *
 * Paging and sorting are excluded — neither narrows anything.
 */
export function hasActiveFilters(query: JobListQuery): boolean {
  return Boolean(
    query.search ||
      query.status?.length ||
      query.source?.length ||
      query.remoteType?.length ||
      query.employmentType?.length ||
      query.experienceLevel?.length ||
      query.company ||
      query.location ||
      query.minSalary !== undefined ||
      query.minRelevance !== undefined ||
      query.postedWithinDays !== undefined ||
      query.hasContact ||
      query.favouriteOnly,
  );
}
