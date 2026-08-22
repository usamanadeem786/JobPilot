/**
 * Words that mark a fragment of a role header as a job title rather than an
 * employer name.
 *
 * CVs write the two halves in both orders — "Acme — Senior Engineer" and
 * "Senior Engineer | Acme" are equally common — so the parser cannot rely on
 * position. Whichever half contains one of these words is the title.
 *
 * Word boundaries matter: without them "Ltd" inside a company name and
 * "overhead" inside a sentence would both register as titles.
 */
export const TITLE_WORDS =
  /\b(engineer|developer|programmer|architect|manager|lead|director|analyst|designer|consultant|scientist|administrator|specialist|officer|intern|head|principal|founder|president|cto|ceo|coo)\b/i;

/** True when the fragment reads like a job title. */
export function looksLikeJobTitle(value: string): boolean {
  return TITLE_WORDS.test(value);
}
