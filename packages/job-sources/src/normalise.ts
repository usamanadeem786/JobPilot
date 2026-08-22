import { createHash } from 'node:crypto';
import { EmploymentType, ExperienceLevel, RemoteType, SalaryPeriod } from '@jobpilot/shared';
import type { NormalisedSalary } from './types';

export { htmlToText, decodeEntities } from './html';

/**
 * Mapping helpers shared by every adapter.
 *
 * Each returns UNKNOWN rather than a plausible default when the source did not
 * say. A job silently labelled "Full-time" because that is the common case is
 * a fabricated fact, and the product's whole position is that inferences are
 * marked as inferences.
 */

export function toRemoteType(value: string | null | undefined): RemoteType {
  if (!value) return RemoteType.UNKNOWN;
  const text = value.toLowerCase();

  if (/\bhybrid\b/.test(text)) return RemoteType.HYBRID;
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b|\bdistributed\b/.test(text)) {
    return RemoteType.REMOTE;
  }
  if (/\bon[- ]?site\b|\bin[- ]?office\b|\bin[- ]?person\b/.test(text)) return RemoteType.ONSITE;

  return RemoteType.UNKNOWN;
}

export function toEmploymentType(value: string | null | undefined): EmploymentType {
  if (!value) return EmploymentType.UNKNOWN;
  const text = value.toLowerCase().replace(/[_\s-]+/g, '');

  if (text.includes('fulltime') || text === 'full') return EmploymentType.FULL_TIME;
  if (text.includes('parttime') || text === 'part') return EmploymentType.PART_TIME;
  if (text.includes('contract') || text.includes('contractor')) return EmploymentType.CONTRACT;
  if (text.includes('temporary') || text.includes('temp')) return EmploymentType.TEMPORARY;
  if (text.includes('intern')) return EmploymentType.INTERNSHIP;
  if (text.includes('freelance')) return EmploymentType.FREELANCE;

  return EmploymentType.UNKNOWN;
}

/**
 * Derived from the job TITLE only, never from the description.
 *
 * A description mentioning "you will mentor senior engineers" does not make
 * the role senior. Titles are the one place seniority is stated as a fact
 * about the position itself.
 */
export function toExperienceLevel(title: string): ExperienceLevel {
  const text = title.toLowerCase();

  if (/\bintern(ship)?\b/.test(text)) return ExperienceLevel.INTERNSHIP;
  if (/\b(chief|cto|cio|vp|vice president|head of)\b/.test(text)) return ExperienceLevel.EXECUTIVE;
  if (/\bprincipal\b|\bdistinguished\b|\bfellow\b/.test(text)) return ExperienceLevel.PRINCIPAL;
  if (/\b(staff|lead|team lead|tech lead)\b/.test(text)) return ExperienceLevel.LEAD;
  if (/\b(senior|snr|sr\.?)\b/.test(text)) return ExperienceLevel.SENIOR;
  if (/\b(junior|jnr|jr\.?|graduate|entry[- ]level|associate)\b/.test(text)) {
    return ExperienceLevel.JUNIOR;
  }
  if (/\b(mid|intermediate)\b/.test(text)) return ExperienceLevel.MID;

  return ExperienceLevel.UNKNOWN;
}

export function toSalaryPeriod(value: string | null | undefined): SalaryPeriod {
  if (!value) return SalaryPeriod.UNKNOWN;
  const text = value.toLowerCase();

  if (text.includes('hour')) return SalaryPeriod.HOURLY;
  if (text.includes('day') || text.includes('daily')) return SalaryPeriod.DAILY;
  if (text.includes('week')) return SalaryPeriod.WEEKLY;
  if (text.includes('month')) return SalaryPeriod.MONTHLY;
  if (text.includes('year') || text.includes('annual')) return SalaryPeriod.YEARLY;

  return SalaryPeriod.UNKNOWN;
}

/**
 * Pulls a salary range out of free text, and returns nothing when unsure.
 *
 * A wrong salary is materially worse than a missing one: it changes which jobs
 * a person applies to. Only explicit currency-marked ranges are accepted.
 */
export function parseSalaryFromText(text: string): NormalisedSalary | undefined {
  const pattern =
    /([$£€])\s?(\d{1,3}(?:,\d{3})+|\d{2,7})(?:\s?[kK])?\s*(?:-|–|—|to)\s*([$£€])?\s?(\d{1,3}(?:,\d{3})+|\d{2,7})(?:\s?[kK])?/;
  const match = pattern.exec(text);
  if (!match?.[1] || !match[2] || !match[4]) return undefined;

  const usesThousands = /[kK]/.test(match[0]);
  const toNumber = (raw: string): number => {
    const value = Number(raw.replace(/,/g, ''));
    return usesThousands && value < 1000 ? value * 1000 : value;
  };

  const min = toNumber(match[2]);
  const max = toNumber(match[4]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return undefined;

  const currency = { $: 'USD', '£': 'GBP', '€': 'EUR' }[match[1]] ?? 'USD';

  return { min, max, currency, period: inferPeriodFromAmount(min, text) };
}

function inferPeriodFromAmount(min: number, text: string): SalaryPeriod {
  const stated = toSalaryPeriod(text.slice(0, 400));
  if (stated !== SalaryPeriod.UNKNOWN) return stated;
  // An explicit period beats a guess; without one, only an obviously hourly
  // magnitude is assumed, and everything else stays UNKNOWN.
  return min < 500 ? SalaryPeriod.HOURLY : SalaryPeriod.UNKNOWN;
}

/**
 * A stable fingerprint of a posting's identity, used to recognise the same job
 * arriving from two different sources.
 *
 * Title, company and location only. The description is excluded on purpose:
 * boards reformat and truncate it, so including it would make the same job
 * hash differently depending on where it was found — which defeats the point.
 */
export function contentHash(title: string, companyName: string, location?: string): string {
  const normalise = (value: string): string =>
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  return createHash('sha256')
    .update([normalise(title), normalise(companyName), normalise(location ?? '')].join('|'))
    .digest('hex');
}

/** Parses a date only when the source supplied one that actually parses. */
export function toPostedAt(value: string | number | null | undefined): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  // A posting date in the future, or before the web existed, is bad data.
  const year = date.getUTCFullYear();
  if (year < 1995 || date.getTime() > Date.now() + 86_400_000) return undefined;

  return date;
}
