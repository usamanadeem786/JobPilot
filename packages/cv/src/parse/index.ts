import { Provenance } from '@jobpilot/shared';
import {
  CvDocumentSchema,
  type CvDate,
  type CvDocument,
  type CvEducationItem,
  type CvExperienceItem,
  type CvSection,
  type CvSkillGroup,
} from '../schema';
import { parsePersonalInfo } from './contact';
import { looksLikeJobTitle } from './title-words';
import { splitIntoSections, toBullets, type DetectedSection } from './sections';

export * from './sections';
export * from './contact';

/**
 * Which parts of the CV were actually read out of the document, and which were
 * simply absent. Stored on `MasterCV.parseProvenance` so the editor can show
 * "we could not find this" rather than an empty box the user assumes is a bug,
 * and so nothing parsed is ever confused with something inferred.
 */
export type CvParseProvenance = Record<CvSection | 'personal', Provenance>;

export interface ParsedCv {
  readonly document: CvDocument;
  readonly provenance: CvParseProvenance;
  /** Headings found in the document but not recognised, for diagnostics. */
  readonly unrecognisedHeadings: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parses "Jan 2020", "2020", "03/2019" — and gives up rather than guessing. */
export function parseCvDate(raw: string): CvDate | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const monthYear = /([a-z]{3,9})\.?\s+(\d{4})/i.exec(trimmed);
  if (monthYear?.[1] && monthYear[2]) {
    const month = MONTHS[monthYear[1].slice(0, 3).toLowerCase()];
    const year = Number(monthYear[2]);
    return { raw: trimmed, year, ...(month ? { month } : {}) };
  }

  const numeric = /(\d{1,2})[/.-](\d{4})/.exec(trimmed);
  if (numeric?.[1] && numeric[2]) {
    const month = Number(numeric[1]);
    return { raw: trimmed, year: Number(numeric[2]), ...(month >= 1 && month <= 12 ? { month } : {}) };
  }

  const yearOnly = /\b(19|20)\d{2}\b/.exec(trimmed);
  if (yearOnly) return { raw: trimmed, year: Number(yearOnly[0]) };

  // "Present", "Current" and anything unrecognised keep the raw text only.
  return { raw: trimmed };
}

const DATE_RANGE =
  /((?:[a-z]{3,9}\.?\s+)?(?:\d{1,2}[/.-])?(?:19|20)\d{2})\s*(?:–|—|-|to|until)\s*((?:[a-z]{3,9}\.?\s+)?(?:\d{1,2}[/.-])?(?:19|20)\d{2}|present|current|now|ongoing)/i;

/**
 * Skills lines take two shapes: "Languages: Python, Go" and a bare list.
 * Both are handled; a line with a colon becomes a categorised group.
 */
function parseSkills(lines: string[]): CvSkillGroup[] {
  const groups: CvSkillGroup[] = [];
  const ungrouped: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    const cleaned = line.replace(/^[•●▪‣⁃*\-–—+·]\s*/u, '').trim();
    if (!cleaned) continue;

    const separator = cleaned.indexOf(':');
    // A colon late in the line is prose, not a category label.
    if (separator > 0 && separator <= 40) {
      const category = cleaned.slice(0, separator).trim();
      const skills = splitSkillList(cleaned.slice(separator + 1));
      if (skills.length > 0) {
        groups.push({ category, skills });
        continue;
      }
    }

    ungrouped.push(...splitSkillList(cleaned));
  }

  if (ungrouped.length > 0) groups.push({ skills: [...new Set(ungrouped)] });
  return groups;
}

function splitSkillList(value: string): string[] {
  return value
    .split(/[,;|•·]|\s{2,}/)
    .map((entry) => entry.trim().replace(/\.$/, ''))
    .filter((entry) => entry.length > 0 && entry.length <= 80);
}

/**
 * Experience entries are separated by their date range: a line containing one
 * starts a new role. That is the most reliable signal available in plain text,
 * where the visual grouping of a CV has been flattened away.
 */
function parseExperience(lines: string[]): CvExperienceItem[] {
  const items: CvExperienceItem[] = [];
  let current: CvExperienceItem | null = null;
  let pendingHeaderLines: string[] = [];

  const flush = (): void => {
    if (current) items.push(current);
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;

    const range = DATE_RANGE.exec(line);
    if (range?.[1] && range[2]) {
      flush();

      // The role and employer sit on the date line itself or just above it.
      const withoutDates = line.replace(range[0], '').replace(/[|,–—-]+\s*$/, '').trim();
      const context = [...pendingHeaderLines, withoutDates].filter(Boolean);
      const { company, title, location } = splitRoleLine(context);

      const endRaw = range[2];
      current = {
        company,
        title,
        ...(location ? { location } : {}),
        ...(parseCvDate(range[1]) ? { startDate: parseCvDate(range[1]) } : {}),
        ...(parseCvDate(endRaw) ? { endDate: parseCvDate(endRaw) } : {}),
        isCurrent: /present|current|now|ongoing/i.test(endRaw),
        bullets: [],
      };
      pendingHeaderLines = [];
      continue;
    }

    // A non-bullet line immediately preceding a date range is the header of
    // the NEXT role, not an achievement of the current one. Without this
    // lookahead, "Backend Developer | Globex Ltd" is swallowed as a bullet of
    // the previous job and that employer is lost entirely.
    if (!isBulletLine(line) && nextNonEmptyHasDateRange(lines, index)) {
      flush();
      pendingHeaderLines = [line];
      continue;
    }

    if (current) {
      current.bullets.push(...toBullets([line]));
    } else {
      pendingHeaderLines.push(line);
      if (pendingHeaderLines.length > 3) pendingHeaderLines.shift();
    }
  }

  flush();
  return items;
}

function isBulletLine(line: string): boolean {
  return /^[•●▪‣⁃*\-–—+·]\s*/u.test(line);
}

function nextNonEmptyHasDateRange(lines: string[], fromIndex: number): boolean {
  for (let index = fromIndex + 1; index < lines.length; index += 1) {
    const candidate = lines[index];
    if (!candidate) continue;
    return DATE_RANGE.test(candidate);
  }
  return false;
}

/**
 * Splits a role header into employer, title and location.
 *
 * "Senior Engineer at Acme, London" is unambiguous. "Acme — Senior Engineer"
 * and "Senior Engineer | Acme" are the same information in opposite orders,
 * and both are common, so the half that reads like a job title decides which
 * is which rather than assuming a fixed position.
 */
function splitRoleLine(context: string[]): { company: string; title: string; location?: string } {
  const combined = context.join(' | ');

  const atForm = /^(.*?)\s+(?:at|@)\s+(.*)$/i.exec(combined);
  if (atForm?.[1] && atForm[2]) {
    const [employer, location] = splitTrailingLocation(atForm[2]);
    return { company: employer, title: atForm[1].trim(), ...(location ? { location } : {}) };
  }

  const parts = combined
    .split(/\s*[|–—]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const first = parts[0];
  const second = parts[1];

  if (first && second) {
    const firstLooksLikeTitle = looksLikeJobTitle(first) && !looksLikeJobTitle(second);
    const titleRaw = firstLooksLikeTitle ? first : second;
    const companyRaw = firstLooksLikeTitle ? second : first;
    const [employer, location] = splitTrailingLocation(companyRaw);
    return { company: employer, title: titleRaw, ...(location ? { location } : {}) };
  }

  return { company: combined.trim() || 'Unknown', title: '' };
}

function splitTrailingLocation(value: string): [string, string | undefined] {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length >= 2) {
    return [parts.slice(0, -1).join(', '), parts.at(-1)];
  }
  return [value.trim(), undefined];
}

function parseEducation(lines: string[]): CvEducationItem[] {
  const items: CvEducationItem[] = [];

  for (const line of lines) {
    if (!line) continue;
    const cleaned = line.replace(/^[•●▪‣⁃*\-–—+·]\s*/u, '').trim();
    if (!cleaned) continue;

    const range = DATE_RANGE.exec(cleaned);
    const yearOnly = /\b(19|20)\d{2}\b/.exec(cleaned);
    const withoutDates = cleaned.replace(range?.[0] ?? yearOnly?.[0] ?? '', '').trim();

    const parts = withoutDates
      .split(/\s*[|–—,]\s*|\s+-\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;

    const endDate = range?.[2]
      ? parseCvDate(range[2])
      : yearOnly
        ? parseCvDate(yearOnly[0])
        : undefined;

    items.push({
      institution: parts[0] as string,
      ...(parts[1] ? { qualification: parts[1] } : {}),
      ...(parts[2] ? { field: parts[2] } : {}),
      ...(range?.[1] ? { startDate: parseCvDate(range[1]) } : {}),
      ...(endDate ? { endDate } : {}),
      bullets: [],
    });
  }

  return items;
}

function sectionLines(sections: DetectedSection[], kind: CvSection): string[] {
  return sections.find((section) => section.section === kind)?.lines ?? [];
}

/**
 * Turns extracted CV text into a structured document.
 *
 * Every field is derived from text actually present in the document. Where a
 * section is missing it is left empty and marked NOT_FOUND — never filled with
 * a plausible guess.
 */
export function parseCv(text: string): ParsedCv {
  const { header, sections } = splitIntoSections(text);

  const personal = parsePersonalInfo(header);

  const summaryLines = sectionLines(sections, 'summary');
  const summary = summaryLines.join(' ').trim();

  const skillGroups = parseSkills(sectionLines(sections, 'skills'));
  const experience = parseExperience(sectionLines(sections, 'experience'));
  const education = parseEducation(sectionLines(sections, 'education'));

  const projectLines = sectionLines(sections, 'projects');
  const projects = toBullets(projectLines).map((line) => {
    const separator = line.indexOf(':');
    return separator > 0 && separator <= 60
      ? { name: line.slice(0, separator).trim(), description: line.slice(separator + 1).trim(), technologies: [], bullets: [] }
      : { name: line.slice(0, 160), technologies: [], bullets: [] };
  });

  const certifications = toBullets(sectionLines(sections, 'certifications')).map((line) => ({
    name: line.slice(0, 200),
  }));

  const achievements = toBullets(sectionLines(sections, 'achievements'));

  const document = CvDocumentSchema.parse({
    personal,
    ...(summary ? { summary } : {}),
    skillGroups,
    experience,
    education,
    projects,
    certifications,
    achievements,
    // Only sections with content are ordered, so a template does not render
    // an empty "Certifications" heading.
    sectionOrder: (['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements'] as CvSection[]).filter(
      (section) => hasContent(section, { summary, skillGroups, experience, education, projects, certifications, achievements }),
    ),
  });

  return {
    document,
    provenance: {
      personal: personal.fullName === 'Unknown' ? Provenance.NOT_FOUND : Provenance.KNOWN,
      summary: summary ? Provenance.KNOWN : Provenance.NOT_FOUND,
      skills: skillGroups.length > 0 ? Provenance.KNOWN : Provenance.NOT_FOUND,
      experience: experience.length > 0 ? Provenance.KNOWN : Provenance.NOT_FOUND,
      projects: projects.length > 0 ? Provenance.KNOWN : Provenance.NOT_FOUND,
      education: education.length > 0 ? Provenance.KNOWN : Provenance.NOT_FOUND,
      certifications: certifications.length > 0 ? Provenance.KNOWN : Provenance.NOT_FOUND,
      achievements: achievements.length > 0 ? Provenance.KNOWN : Provenance.NOT_FOUND,
    },
    unrecognisedHeadings: [],
  };
}

function hasContent(
  section: CvSection,
  parts: {
    summary: string;
    skillGroups: unknown[];
    experience: unknown[];
    education: unknown[];
    projects: unknown[];
    certifications: unknown[];
    achievements: unknown[];
  },
): boolean {
  switch (section) {
    case 'summary':
      return parts.summary.length > 0;
    case 'skills':
      return parts.skillGroups.length > 0;
    case 'experience':
      return parts.experience.length > 0;
    case 'projects':
      return parts.projects.length > 0;
    case 'education':
      return parts.education.length > 0;
    case 'certifications':
      return parts.certifications.length > 0;
    case 'achievements':
      return parts.achievements.length > 0;
  }
}
