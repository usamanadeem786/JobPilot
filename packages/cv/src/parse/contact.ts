import type { CvLink, CvPersonalInfo } from '../schema';

/**
 * Contact details are pulled from the header block by pattern, never inferred.
 * If a CV has no phone number, the field stays empty — inventing a plausible
 * one would be exactly the fabrication the product forbids.
 */

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.\p{L}{2,}/u;

/**
 * Deliberately conservative. A loose phone pattern matches dates, postcodes
 * and employee IDs; a wrong number on a CV is worse than a missing one.
 */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?/;

const URL = /(?:https?:\/\/|www\.)[^\s,;<>()]+/i;

interface KnownLink {
  readonly label: string;
  readonly test: RegExp;
}

const KNOWN_LINKS: KnownLink[] = [
  { label: 'LinkedIn', test: /linkedin\.com/i },
  { label: 'GitHub', test: /github\.com/i },
  { label: 'GitLab', test: /gitlab\.com/i },
  { label: 'Portfolio', test: /.*/ },
];

export function extractEmail(text: string): string | undefined {
  return EMAIL.exec(text)?.[0];
}

export function extractPhone(text: string): string | undefined {
  // Strip emails and URLs first: both contain digit runs that look like phone
  // numbers to any pattern loose enough to match international formats.
  const withoutNoise = text.replace(new RegExp(EMAIL, 'gu'), ' ').replace(/https?:\/\/\S+/g, ' ');

  for (const line of withoutNoise.split('\n')) {
    const candidate = PHONE.exec(line)?.[0]?.trim();
    if (!candidate) continue;

    const digits = candidate.replace(/\D/g, '');
    // Shorter than 7 is not a phone number; longer than 15 breaks E.164.
    if (digits.length >= 7 && digits.length <= 15) return candidate;
  }

  return undefined;
}

export function extractLinks(text: string): CvLink[] {
  const found = new Map<string, CvLink>();

  for (const match of text.matchAll(new RegExp(URL, 'gi'))) {
    const raw = match[0].replace(/[.,;:]+$/, '');
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    if (found.has(url.toLowerCase())) continue;

    const label = KNOWN_LINKS.find((known) => known.test.test(url))?.label ?? 'Link';
    found.set(url.toLowerCase(), { label, url });
  }

  return [...found.values()].slice(0, 12);
}

/**
 * The name is the first line that reads like one: no digits, no email, no URL,
 * few words. CVs put it at the top in larger type, and that ordering survives
 * text extraction even though the styling does not.
 */
export function extractName(headerLines: string[]): string | undefined {
  for (const line of headerLines.slice(0, 6)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 60) continue;
    if (EMAIL.test(trimmed) || /https?:\/\/|www\./i.test(trimmed)) continue;
    if (/\d/.test(trimmed)) continue;
    if (/[@|/\\]/.test(trimmed)) continue;

    const words = trimmed.split(/\s+/);
    if (words.length < 1 || words.length > 5) continue;
    // "CURRICULUM VITAE" and "RESUME" are titles, not names.
    if (/^(curriculum vitae|resume|cv)$/i.test(trimmed)) continue;

    return trimmed;
  }

  return undefined;
}

/**
 * A headline is a short role line near the name — "Senior Backend Engineer".
 * Only taken when it looks like a job title rather than prose.
 */
export function extractHeadline(headerLines: string[], name: string | undefined): string | undefined {
  const startIndex = name ? headerLines.findIndex((line) => line.trim() === name) + 1 : 0;

  for (const line of headerLines.slice(startIndex, startIndex + 3)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 80) continue;
    if (EMAIL.test(trimmed) || /https?:\/\/|www\./i.test(trimmed)) continue;
    if (/[.!?]$/.test(trimmed)) continue;
    if (trimmed.split(/\s+/).length > 8) continue;

    return trimmed;
  }

  return undefined;
}

export function parsePersonalInfo(headerLines: string[]): CvPersonalInfo {
  const headerText = headerLines.join('\n');
  const fullName = extractName(headerLines);

  const email = extractEmail(headerText);
  const phone = extractPhone(headerText);
  const headline = extractHeadline(headerLines, fullName);
  const links = extractLinks(headerText);

  return {
    // The name is required by the schema. When it cannot be read, the upload
    // still succeeds with a clear placeholder for the user to correct, rather
    // than the parse failing outright.
    fullName: fullName ?? 'Unknown',
    ...(headline ? { headline } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    links,
  };
}
