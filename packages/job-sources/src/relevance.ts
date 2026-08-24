import type { NormalisedJob, NormalisedQuery } from './types';

/**
 * Keyword matching and ranking, shared by every adapter that filters locally.
 *
 * Boards like Greenhouse and Lever have no search parameter — the whole board
 * comes back and the filtering is ours to do. Two things about that are easy
 * to get wrong, and both make search useless rather than merely imperfect:
 *
 *  - Matching the description as well as the title sounds generous and is
 *    catastrophic. Nearly every posting at a technology company contains the
 *    word "engineer" somewhere ("you will work with engineers"), so a search
 *    for "engineer" returns the entire sales department.
 *  - Truncating to the limit before ranking hands back whatever the board
 *    happened to list first, which is usually alphabetical. The good matches
 *    are then discarded in favour of "Account Executive, Enterprise".
 *
 * So a term must earn its place in the title, and results are ranked before
 * they are cut.
 */

export function queryTerms(keywords: string): string[] {
  return keywords
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
}

/** Whole-word match, so "go" does not match "going" or "category". */
function containsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

export function matchesQuery(job: NormalisedJob, query: NormalisedQuery): boolean {
  const terms = queryTerms(query.keywords);

  if (terms.length > 0) {
    const title = job.title.toLowerCase();
    const haystack = `${job.title}\n${job.description}`.toLowerCase();

    // Every term has to appear somewhere...
    if (!terms.every((term) => containsTerm(haystack, term))) return false;

    // ...and at least one of them has to be in the title. This is what keeps
    // "engineer" from returning account executives, while still allowing
    // "senior python engineer" to match a "Senior Engineer" whose description
    // is the only place Python is named.
    if (!terms.some((term) => containsTerm(title, term))) return false;
  }

  if (query.remoteOnly && job.remoteType !== 'REMOTE') return false;

  if (query.location) {
    const wanted = query.location.toLowerCase();
    const actual = (job.location ?? '').toLowerCase();
    // "Remote" as a location matches a remote job wherever it is filed.
    const remoteWanted = /remote|anywhere/.test(wanted);
    if (!(remoteWanted && job.remoteType === 'REMOTE') && !actual.includes(wanted)) return false;
  }

  // Only excluded when the posting actually published a maximum. A job whose
  // salary was never stated is not evidence that it pays too little.
  if (query.minSalary !== undefined && job.salary?.max !== undefined) {
    if (job.salary.max < query.minSalary) return false;
  }

  return true;
}

/**
 * How well a posting answers the query. Higher is better.
 *
 * Deliberately simple and explainable: title matches dominate, an exact title
 * phrase wins outright, and a known posting date breaks ties in favour of the
 * fresher role. This is ordering for a fetch, not the AI match score — that is
 * a separate, per-user judgement made against the CV.
 */
export function relevanceOf(job: NormalisedJob, query: NormalisedQuery): number {
  const terms = queryTerms(query.keywords);
  if (terms.length === 0) return 0;

  const title = job.title.toLowerCase();
  const description = job.description.toLowerCase();
  const phrase = query.keywords.trim().toLowerCase();

  let score = 0;

  if (phrase.length > 1 && title.includes(phrase)) score += 50;

  for (const term of terms) {
    if (containsTerm(title, term)) score += 10;
    else if (containsTerm(description, term)) score += 1;
  }

  // A small nudge, not a reordering: relevance should not be overturned by
  // recency, and a posting with no published date must not be penalised into
  // invisibility for something its source failed to provide.
  if (job.postedAtKnown) score += 1;

  return score;
}

/** Filters, ranks, then truncates — in that order. */
export function selectBestMatches(
  jobs: readonly NormalisedJob[],
  query: NormalisedQuery,
  limit: number,
): NormalisedJob[] {
  return jobs
    .filter((job) => matchesQuery(job, query))
    .map((job) => ({ job, score: relevanceOf(job, query) }))
    .sort((a, b) => b.score - a.score || a.job.title.localeCompare(b.job.title))
    .slice(0, limit)
    .map((entry) => entry.job);
}
