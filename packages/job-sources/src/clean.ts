/**
 * Field-level cleanup applied to everything a source returns.
 *
 * Real board data is untidy: titles arrive as "Account Executive, Crypto  "
 * and locations as "Germany ". Left alone, that whitespace reaches the table,
 * the CSV export and the tailoring prompt, and it also breaks exact-match
 * grouping — "Germany" and "Germany " are two different locations to a
 * GROUP BY.
 *
 * Applied centrally rather than in each adapter, so a new source cannot
 * forget it.
 */

/** Collapses internal runs of whitespace and trims the ends. */
export function cleanField(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Same, but returns undefined for a value that is empty once cleaned. */
export function cleanOptional(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = cleanField(value);
  return cleaned.length > 0 ? cleaned : undefined;
}
