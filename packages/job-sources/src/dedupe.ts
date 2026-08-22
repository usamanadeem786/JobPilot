import type { NormalisedJob } from './types';

/**
 * Three-tier deduplication.
 *
 * The same vacancy legitimately arrives more than once: re-run searches return
 * it again, and one employer's role appears on both its Greenhouse board and
 * an aggregator. Each tier catches a different case, cheapest first.
 *
 *  1. (sourceKey, externalJobId) — the same posting refetched from one source.
 *  2. contentHash — title + company + location, so the same role from two
 *     sources collapses even though the ids differ.
 *  3. Title similarity within a company — near-duplicates like
 *     "Senior Python Developer" and "Senior Python Developer (Remote)".
 *
 * Tier 3 is the only fuzzy one and is deliberately conservative: merging two
 * genuinely different roles hides a job from the user, which is worse than
 * showing one duplicate.
 */

export interface DedupeResult {
  readonly unique: NormalisedJob[];
  readonly duplicatesRemoved: number;
  /** Near-duplicates, kept but flagged so the UI can group them. */
  readonly nearDuplicates: NearDuplicate[];
}

export interface NearDuplicate {
  readonly keptExternalId: string;
  readonly droppedExternalId: string;
  readonly similarity: number;
  readonly reason: 'exact-id' | 'content-hash' | 'title-similarity';
}

/** Above this, two titles at the same company are treated as one role. */
const TITLE_SIMILARITY_THRESHOLD = 0.9;

export function deduplicateJobs(jobs: readonly NormalisedJob[]): DedupeResult {
  const bySourceId = new Set<string>();
  const byContentHash = new Map<string, NormalisedJob>();
  const byCompany = new Map<string, NormalisedJob[]>();

  const unique: NormalisedJob[] = [];
  const nearDuplicates: NearDuplicate[] = [];
  let duplicatesRemoved = 0;

  for (const job of jobs) {
    const sourceId = `${job.sourceKey}:${job.externalJobId}`;
    if (bySourceId.has(sourceId)) {
      duplicatesRemoved += 1;
      continue;
    }

    const existingByHash = byContentHash.get(job.contentHash);
    if (existingByHash) {
      duplicatesRemoved += 1;
      nearDuplicates.push({
        keptExternalId: existingByHash.externalJobId,
        droppedExternalId: job.externalJobId,
        similarity: 1,
        reason: 'content-hash',
      });
      continue;
    }

    const companyKey = normaliseForComparison(job.companyName);
    const siblings = byCompany.get(companyKey) ?? [];
    const similar = siblings.find(
      (candidate) =>
        titleSimilarity(candidate.title, job.title) >= TITLE_SIMILARITY_THRESHOLD,
    );

    if (similar) {
      duplicatesRemoved += 1;
      nearDuplicates.push({
        keptExternalId: similar.externalJobId,
        droppedExternalId: job.externalJobId,
        similarity: titleSimilarity(similar.title, job.title),
        reason: 'title-similarity',
      });
      continue;
    }

    bySourceId.add(sourceId);
    byContentHash.set(job.contentHash, job);
    byCompany.set(companyKey, [...siblings, job]);
    unique.push(job);
  }

  return { unique, duplicatesRemoved, nearDuplicates };
}

export function normaliseForComparison(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Working-arrangement and contract words that boards bolt onto a title.
 * They describe how the role is worked, not which role it is, so
 * "Senior Python Developer" and "Senior Python Developer (Remote)" are the
 * same vacancy advertised twice.
 */
const TITLE_NOISE = new Set([
  'remote',
  'hybrid',
  'onsite',
  'fulltime',
  'parttime',
  'permanent',
  'contract',
  'temporary',
  'freelance',
  'f',
  'm',
  'd',
  'w',
  'x',
]);

/**
 * Splits a title into the tokens that identify the ROLE.
 *
 * Parenthesised and bracketed segments are dropped wholesale — they carry
 * location, arrangement or requisition ids, never the job itself — and the
 * remaining working-arrangement words are filtered out.
 */
function tokeniseTitle(value: string): Set<string> {
  const withoutBrackets = value.replace(/[([{][^)\]}]*[)\]}]/g, ' ');

  return new Set(
    normaliseForComparison(withoutBrackets)
      .split(' ')
      .filter((token) => token.length > 0 && !TITLE_NOISE.has(token)),
  );
}

/**
 * Token-based Jaccard similarity rather than edit distance.
 *
 * Edit distance punishes a parenthetical suffix — "(Remote)" — far more than
 * it should, while treating "Senior" and "Junior" as nearly identical because
 * only two characters differ. Comparing word sets gets both cases right.
 */
export function titleSimilarity(left: string, right: string): number {
  const a = tokeniseTitle(left);
  const b = tokeniseTitle(right);
  if (a.size === 0 || b.size === 0) return 0;

  // Seniority words are the whole difference between two otherwise identical
  // titles, so a mismatch there disqualifies the pair outright.
  const seniority = ['junior', 'jnr', 'jr', 'senior', 'snr', 'sr', 'lead', 'principal', 'staff', 'intern', 'graduate'];
  for (const word of seniority) {
    if (a.has(word) !== b.has(word)) return 0;
  }

  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;

  return shared / (a.size + b.size - shared);
}
