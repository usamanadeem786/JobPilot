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

/**
 * A date range, e.g. "March 2021 – Present" or "2018 - 2021".
 *
 * The leading `\b` matters more than it looks. The optional month is
 * `[a-z]{3,9}`, and without a boundary the engine will happily start matching
 * inside a word: "Cambridge University 2019 – 2020" matches from "niversity",
 * so removing the range to isolate the text leaves "Cambridge U". Any word
 * longer than nine letters before a date loses its tail the same way —
 * "Technology", "Engineering", "Intelligence" — which is a large share of real
 * CVs.
 */
const DATE_RANGE =
  /\b((?:[a-z]{3,9}\.?\s+)?(?:\d{1,2}[/.-])?(?:19|20)\d{2})\s*(?:–|—|-|to|until)\s*((?:[a-z]{3,9}\.?\s+)?(?:\d{1,2}[/.-])?(?:19|20)\d{2}|present|current|now|ongoing)/i;

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

      // Many CVs put the job title and dates on one line and the employer on
      // the line below. In that layout the date line yields a single field,
      // which `splitRoleLine` can only read as the employer — losing the title
      // and filing the role under a company that does not exist. Looking one
      // line ahead recovers the pair.
      const belowIndex = employerBelowIndex(lines, index);
      if (context.length === 1 && belowIndex !== null) {
        context.push(lines[belowIndex] as string);
        index = belowIndex;
      }

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
    //
    // `couldBeRoleHeader` is what keeps that from going the other way. Not
    // every CV marks its bullets — some are laid out with plain paragraphs —
    // and there the last achievement of one role sits directly above the next
    // role's dates. Treated as a header it becomes the employer, so a sentence
    // out of the applicant's CV is filed as a company that does not exist.
    if (!isBulletLine(line) && couldBeRoleHeader(line) && nextNonEmptyHasDateRange(lines, index)) {
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

/**
 * The index of an employer line sitting directly beneath a date line.
 *
 * Strictly the next line, never across a blank one: a blank line is a
 * paragraph break, and in a CV whose bullets carry no marker the first line
 * after that break is an achievement, not a company. Reading it as the
 * employer would put a sentence from the CV into the employer field — an
 * invented company, which is exactly what must never happen.
 *
 * Prose is rejected for the same reason: company names are short and do not
 * end in a full stop.
 */
const MAX_EMPLOYER_WORDS = 8;

/**
 * Whether a line could be a role header rather than an achievement.
 *
 * Headers are short noun phrases — "Senior Engineer | Acme". Achievements are
 * sentences. The full stop is the strongest signal and the word count catches
 * the rest; anything longer is prose whichever way it ends.
 */
const MAX_ROLE_HEADER_WORDS = 14;

function couldBeRoleHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('.')) return false;
  if (trimmed.length > 120) return false;
  return trimmed.split(/\s+/).length <= MAX_ROLE_HEADER_WORDS;
}

function employerBelowIndex(lines: string[], dateLineIndex: number): number | null {
  const candidate = lines[dateLineIndex + 1];
  if (!candidate) return null;

  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (isBulletLine(trimmed)) return null;
  if (DATE_RANGE.test(trimmed)) return null;
  if (trimmed.endsWith('.')) return null;
  if (trimmed.length > 80) return null;
  if (trimmed.split(/\s+/).length > MAX_EMPLOYER_WORDS) return null;

  return dateLineIndex + 1;
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

/**
 * Separates an employer from a trailing location.
 *
 * A middot is checked first because it is an explicit separator: "Acme ·
 * Lahore, Pakistan" is one company and one two-part location, and splitting on
 * the comma instead yields the company "Acme · Lahore" in a city called
 * "Pakistan". Only when there is no explicit separator does the comma get to
 * decide, and then only the last segment is taken as the location.
 */
function splitTrailingLocation(value: string): [string, string | undefined] {
  const explicit = value.split(/\s*[·|]\s*/).map((part) => part.trim()).filter(Boolean);
  if (explicit.length >= 2) {
    return [explicit[0] as string, explicit.slice(1).join(', ')];
  }

  const parts = value.split(',').map((part) => part.trim());
  if (parts.length >= 2) {
    return [parts.slice(0, -1).join(', '), parts.at(-1)];
  }

  return [value.trim(), undefined];
}

/** Words that mark a line as the name of a place of study rather than a award. */
const INSTITUTION_WORDS =
  /\b(university|universit[ée]|college|institute|institution|school|academy|polytechnic|seminary|conservatoire|uet|nust|fast)\b/i;

/** Words that mark a line as the qualification itself. */
const QUALIFICATION_WORDS =
  /\b(bachelor|master|doctor|phd|dphil|mphil|bsc|b\.sc|ba|b\.a|beng|btech|be|msc|m\.sc|ma|m\.a|meng|mtech|mba|mres|llb|llm|md|associate|diploma|certificate|hnd|foundation|a-?levels?|gcse|matric|intermediate|fsc)\b/i;

function looksLikeInstitution(value: string): boolean {
  return INSTITUTION_WORDS.test(value);
}

function looksLikeQualification(value: string): boolean {
  return QUALIFICATION_WORDS.test(value);
}

/**
 * Marks of attainment, which sit on their own line under the degree.
 *
 * Classified before institution and qualification, because "First class
 * honours" contains none of their words and would otherwise fall through to
 * the catch-all and become a place of study.
 */
const GRADE_WORDS =
  /\b(first class|second class|upper second|lower second|third class|distinction|merit|honou?rs|gpa|cgpa|grade|percentage|cum laude|magna|summa|[0-9]\.[0-9]{1,2}\s*\/\s*[0-9]|[1-3]:[12])\b/i;

function looksLikeGrade(value: string): boolean {
  return GRADE_WORDS.test(value);
}

/**
 * Splits an education line into its fields.
 *
 * Commas are treated as a separator only as a last resort, and only when the
 * split actually separates a qualification from a place of study. Institution
 * names contain commas of their own — "University of Engineering and
 * Technology, Lahore" is one institution, not an institution and a degree —
 * and splitting on them unconditionally files the city as the qualification.
 */
function splitEducationLine(value: string): string[] {
  const strong = value
    .split(/\s*[|–—]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (strong.length > 1) return strong;

  const commaParts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (commaParts.length === 2) {
    const [first, second] = commaParts as [string, string];
    const separatesTheTwo =
      (looksLikeQualification(first) && looksLikeInstitution(second)) ||
      (looksLikeInstitution(first) && looksLikeQualification(second));

    if (separatesTheTwo) return commaParts;
  }

  return strong.length > 0 ? strong : [value.trim()].filter(Boolean);
}

/**
 * Parses the education section.
 *
 * One entry is frequently spread over two lines — the qualification on one and
 * the institution on the next, in either order — so a line cannot be assumed
 * to be a whole entry. Treating each line as its own entry, as a naive reader
 * does, produces two half-filled records per degree with the qualification
 * sitting in the institution field.
 *
 * Where a line cannot be classified it becomes the institution, which is the
 * field a bare "Harvard" or "Lahore Grammar School" almost always is. Nothing
 * is invented to fill the other fields.
 */
function parseEducation(lines: string[]): CvEducationItem[] {
  const items: CvEducationItem[] = [];
  let current: (CvEducationItem & { hasInstitution: boolean }) | null = null;

  const flush = (): void => {
    if (!current) return;
    const { hasInstitution: _ignored, ...item } = current;
    items.push(item);
    current = null;
  };

  for (const line of lines) {
    // Blank lines are deliberately not treated as entry separators. DOCX
    // extraction puts one between every paragraph, so doing so would split
    // each degree away from its own grade. Which slots are already filled is
    // the reliable signal, and it works the same for both formats.
    if (!line) continue;

    const cleaned = line.replace(/^[•●▪‣⁃*\-–—+·]\s*/u, '').trim();
    if (!cleaned) continue;

    const range = DATE_RANGE.exec(cleaned);
    const yearOnly = /\b(19|20)\d{2}\b/.exec(cleaned);
    const withoutDates = cleaned.replace(range?.[0] ?? yearOnly?.[0] ?? '', '').trim();

    const endDate = range?.[2]
      ? parseCvDate(range[2])
      : yearOnly
        ? parseCvDate(yearOnly[0])
        : undefined;
    const startDate = range?.[1] ? parseCvDate(range[1]) : undefined;

    const parts = splitEducationLine(withoutDates);
    if (parts.length === 0) continue;

    // A line carrying both halves is a complete entry on its own.
    if (parts.length >= 2) {
      flush();
      const institutionFirst = looksLikeInstitution(parts[0] as string) || !looksLikeQualification(parts[0] as string);
      const institution = (institutionFirst ? parts[0] : parts[1]) as string;
      const qualification = (institutionFirst ? parts[1] : parts[0]) as string;

      // Left open rather than pushed, so a grade on the following line still
      // has an entry to attach itself to.
      current = {
        institution,
        qualification,
        hasInstitution: true,
        ...(parts[2] ? { field: parts[2] } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        bullets: [],
      };
      continue;
    }

    const only = parts[0] as string;
    const isGrade = looksLikeGrade(only);
    const isInstitution = !isGrade && looksLikeInstitution(only);
    const isQualification = !isGrade && !isInstitution && looksLikeQualification(only);

    // A grade belongs to the entry above it. Without this it becomes an
    // institution of its own, and the CV grows a university called
    // "First class honours".
    if (current && isGrade && current.grade === undefined) {
      current.grade = only;
      continue;
    }

    // Fill the slot the current entry is missing; otherwise start a new one.
    if (current && isInstitution && !current.hasInstitution) {
      current.institution = only;
      current.hasInstitution = true;
      if (startDate) current.startDate = startDate;
      if (endDate) current.endDate = endDate;
      continue;
    }

    if (current && isQualification && current.qualification === undefined) {
      current.qualification = only;
      if (startDate) current.startDate = startDate;
      if (endDate) current.endDate = endDate;
      continue;
    }

    flush();
    current = {
      institution: isQualification ? '' : only,
      hasInstitution: !isQualification,
      ...(isQualification ? { qualification: only } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      bullets: [],
    };
  }

  flush();

  // An entry whose institution was never found keeps the qualification rather
  // than being dropped: losing a degree is worse than an empty field, and the
  // editor shows the gap for the user to complete.
  return items.map((item) =>
    item.institution ? item : { ...item, institution: item.qualification ?? 'Unknown' },
  );
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
