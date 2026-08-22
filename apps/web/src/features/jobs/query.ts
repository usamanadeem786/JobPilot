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
