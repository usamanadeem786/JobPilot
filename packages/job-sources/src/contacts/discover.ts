import { ContactRole, Provenance } from '@jobpilot/shared';

/**
 * Contact discovery.
 *
 * The brief asked to "identify recruiter email addresses". The compliant
 * version of that is narrow, and worth stating plainly: this finds contact
 * details that an employer DELIBERATELY PUBLISHED in a job posting they wrote
 * for applicants to read. Nothing is scraped from a profile, nothing is
 * enriched from a third-party dataset, and no address is ever constructed.
 *
 * The single most important thing this module does is refuse to guess. Given
 * "Jane Smith" at "Acme Inc", it will not produce jane.smith@acme.com. That
 * address might be right, and being right is not the point: an unverified
 * address is personal data with no lawful basis, it bounces, and it gets the
 * sender marked as spam. `NOT_FOUND` is a correct answer.
 */

export interface DiscoveredContact {
  readonly name: string | null;
  readonly title: string | null;
  readonly role: ContactRole;
  readonly email: string | null;
  readonly profileUrl: string | null;
  /** Where this came from, for the audit trail and the UI badge. */
  readonly source: string;
  readonly sourceUrl: string;
  /** 0–1. How confident, and of what, is spelled out in `evidence`. */
  readonly confidence: number;
  readonly provenance: Provenance;
  /** The text this was read from, so a user can check it themselves. */
  readonly evidence: string;
}

export interface DiscoveryResult {
  readonly contacts: DiscoveredContact[];
  /** Set when nothing legitimate was found, for the UI to display verbatim. */
  readonly message: string | null;
}

/** What the UI shows when no permitted source yielded anything. */
export const NO_CONTACT_MESSAGE = 'No verified public contact found.';

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.\p{L}{2,}/gu;

/**
 * Addresses that are published precisely so strangers can write to them.
 *
 * A role address is an organisation's front door: no individual's personal
 * data is involved, and using it is what it exists for. These get higher
 * confidence than a named individual's address found in the same text.
 */
const ROLE_MAILBOXES = [
  'careers',
  'jobs',
  'recruiting',
  'recruitment',
  'talent',
  'hiring',
  'hr',
  'people',
  'apply',
  'applications',
  'work',
  'joinus',
  'join',
];

/**
 * Addresses that are never a hiring contact, however they appear.
 *
 * The accommodations and accessibility entries were added after running this
 * over real postings: Figma publishes `accommodations-ext@figma.com` in every
 * job description, and it is an address for disability accommodation
 * requests. It is a published address, it is on the posting, and sending a
 * speculative job pitch there would be a misuse of a channel that exists for
 * something else entirely. Published does not mean fair game.
 */
const NEVER_CONTACT = [
  'accommodation',
  'accommodations',
  'accessibility',
  'ada-',
  'disability',
  'ethics',
  'compliance',
  'whistleblow',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'privacy',
  'legal',
  'abuse',
  'postmaster',
  'webmaster',
  'security',
  'support',
  'help',
  'sales',
  'billing',
  'press',
  'media',
  'info@example',
  'example.com',
  'yourcompany',
  'domain.com',
];

interface RoleRule {
  readonly role: ContactRole;
  readonly pattern: RegExp;
}

const ROLE_RULES: readonly RoleRule[] = [
  { role: ContactRole.TALENT_ACQUISITION, pattern: /\btalent acquisition\b|\bta partner\b/i },
  { role: ContactRole.RECRUITER, pattern: /\brecruit(er|ing|ment)\b|\bsourcer\b/i },
  { role: ContactRole.HIRING_MANAGER, pattern: /\bhiring manager\b/i },
  { role: ContactRole.ENGINEERING_MANAGER, pattern: /\bengineering manager\b|\bem\b/i },
  { role: ContactRole.HR, pattern: /\bhuman resources\b|\bhr\b|\bpeople (team|ops|partner)\b/i },
  { role: ContactRole.CTO, pattern: /\bcto\b|\bchief technology\b/i },
  { role: ContactRole.CEO, pattern: /\bceo\b|\bchief executive\b/i },
  { role: ContactRole.FOUNDER, pattern: /\bfounder\b|\bco-?founder\b/i },
];

export function classifyRole(context: string): ContactRole {
  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(context)) return rule.role;
  }
  return ContactRole.OTHER;
}

function localPart(email: string): string {
  return email.split('@')[0]?.toLowerCase() ?? '';
}

function isRoleMailbox(email: string): boolean {
  const local = localPart(email).replace(/[.\-_+]/g, '');
  return ROLE_MAILBOXES.some((mailbox) => local === mailbox || local.startsWith(mailbox));
}

export function isNeverContact(email: string): boolean {
  const lower = email.toLowerCase();
  return NEVER_CONTACT.some((term) => lower.includes(term));
}

/**
 * Reads contact details out of a job description.
 *
 * This is the one source the product treats as unambiguously permitted: the
 * employer wrote the posting, published it for applicants, and put the address
 * in it. Anything else — profile pages, data brokers, guessed patterns — is
 * out of scope by design, not by omission.
 */
export function extractContactsFromJobDescription(input: {
  readonly description: string;
  readonly companyName: string;
  readonly jobUrl: string;
}): DiscoveryResult {
  const seen = new Set<string>();
  const contacts: DiscoveredContact[] = [];

  for (const match of input.description.matchAll(EMAIL)) {
    const email = match[0];
    const lower = email.toLowerCase();

    if (seen.has(lower) || isNeverContact(email)) continue;
    seen.add(lower);

    // A window around the address, which is where a name or job title sits
    // when the employer wrote one.
    const start = Math.max(0, (match.index ?? 0) - 160);
    const evidence = input.description.slice(start, (match.index ?? 0) + email.length + 80).trim();

    const roleMailbox = isRoleMailbox(email);
    const name = roleMailbox ? null : findNameNear(input.description, match.index ?? 0);

    contacts.push({
      name,
      title: findTitleNear(evidence),
      role: classifyRole(evidence),
      email,
      profileUrl: null,
      source: 'job-description',
      sourceUrl: input.jobUrl,
      // A role mailbox is exactly what it appears to be. A named individual's
      // address read from surrounding prose is a weaker reading of the text,
      // and is scored to say so.
      confidence: roleMailbox ? 0.95 : name ? 0.7 : 0.55,
      // The employer published it, so it is KNOWN — but never VERIFIED, which
      // this product reserves for confirmation against a second source.
      provenance: Provenance.KNOWN,
      evidence: collapse(evidence),
    });
  }

  if (contacts.length === 0) {
    return { contacts: [], message: NO_CONTACT_MESSAGE };
  }

  // Role mailboxes first: they are the address the employer intends
  // applicants to use.
  contacts.sort((left, right) => right.confidence - left.confidence);
  return { contacts, message: null };
}

/**
 * Looks for a personal name immediately before an address.
 *
 * Deliberately strict — two or three capitalised words within a short window.
 * A loose match attaches the wrong person's name to an address, which is worse
 * than attaching none.
 */
function findNameNear(text: string, emailIndex: number): string | null {
  const before = text.slice(Math.max(0, emailIndex - 120), emailIndex);
  const matches = [...before.matchAll(/\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,15})(?:\s+([A-Z][a-z]{1,15}))?\b/g)];
  const last = matches.at(-1);
  if (!last) return null;

  const candidate = last.slice(1).filter(Boolean).join(' ');
  // Reject sentence starts and company names that happen to be capitalised.
  if (/\b(We|Our|The|This|You|Please|Contact|Email|Send|Apply|Job|Role|Team)\b/.test(candidate)) {
    return null;
  }
  return candidate;
}

function findTitleNear(evidence: string): string | null {
  const match =
    /\b((?:senior |lead |principal |head of )?(?:technical )?(?:recruiter|talent acquisition (?:partner|specialist|manager)|hiring manager|engineering manager|people partner|hr (?:manager|partner)))\b/i.exec(
      evidence,
    );
  return match?.[1] ? titleCase(match[1]) : null;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * Explicitly not implemented, and kept here so the decision is visible in the
 * code rather than only in a document.
 *
 * Guessing an address from a name and a domain is the standard technique and
 * the product refuses it: the output is unverified personal data, it has no
 * lawful basis under GDPR, and a wrong guess sends a stranger's inbox a job
 * application. There is no flag to enable this.
 */
export function guessEmailFromName(): never {
  throw new Error(
    'Email addresses are never guessed from a name and domain. Only addresses an employer published are stored.',
  );
}
