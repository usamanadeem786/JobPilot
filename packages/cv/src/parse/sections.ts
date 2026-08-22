import { CV_SECTIONS, type CvSection } from '../schema';

/**
 * Heading synonyms, longest-first within each section so that
 * "Professional Experience" wins over "Experience".
 *
 * This is deliberately a deterministic parser rather than an LLM call. It runs
 * with no API key, no cost and no network, its failures are reproducible, and
 * it gives Phase 5's AI structuring a baseline to be measured against instead
 * of being the only implementation.
 */
const SECTION_HEADINGS: Record<CvSection, string[]> = {
  summary: [
    'professional summary',
    'personal statement',
    'career objective',
    'career summary',
    'about me',
    'profile',
    'summary',
    'objective',
    'about',
  ],
  skills: [
    'technical skills',
    'core competencies',
    'skills & abilities',
    'key skills',
    'technologies',
    'competencies',
    'skills',
    'expertise',
    'tech stack',
  ],
  experience: [
    'professional experience',
    'work experience',
    'employment history',
    'career history',
    'work history',
    'experience',
    'employment',
  ],
  projects: ['personal projects', 'selected projects', 'side projects', 'projects', 'portfolio'],
  education: ['education & training', 'academic background', 'qualifications', 'education'],
  certifications: [
    'certifications & licenses',
    'certifications',
    'certificates',
    'licenses',
    'courses',
  ],
  achievements: [
    'awards & achievements',
    'achievements',
    'accomplishments',
    'awards',
    'honors',
    'honours',
  ],
};

export interface DetectedSection {
  readonly section: CvSection;
  readonly heading: string;
  readonly lines: string[];
}

/**
 * A heading is a short line that matches a known synonym and is not a sentence.
 * Length and punctuation do most of the work: "Experience" is a heading,
 * "I have 6 years of experience building APIs" is not, even though both
 * contain the word.
 */
const MAX_HEADING_WORDS = 4;

export function matchHeading(line: string): CvSection | null {
  const cleaned = line
    .trim()
    // CVs decorate headings with rules, colons, dashes and box characters.
    // Strip anything that is not a letter or digit from both ends.
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .toLowerCase();

  if (!cleaned || cleaned.length > 40) return null;
  if (cleaned.split(/\s+/).length > MAX_HEADING_WORDS) return null;
  // A line ending in a full stop is prose, not a heading.
  if (/[.!?]$/.test(line.trim())) return null;

  for (const section of CV_SECTIONS) {
    const synonyms = SECTION_HEADINGS[section];
    if (synonyms.some((synonym) => cleaned === synonym)) return section;
  }
  return null;
}

/**
 * Splits raw CV text into sections.
 *
 * Everything before the first recognised heading is the header block — name,
 * contact details, and often an unlabelled summary — and is returned
 * separately rather than guessed at here.
 */
export function splitIntoSections(text: string): {
  header: string[];
  sections: DetectedSection[];
} {
  const lines = text.split('\n').map((line) => line.trim());

  const header: string[] = [];
  const sections: DetectedSection[] = [];
  let current: { section: CvSection; heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const matched = line ? matchHeading(line) : null;

    if (matched) {
      if (current) sections.push(current);
      current = { section: matched, heading: line.trim(), lines: [] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else {
      header.push(line);
    }
  }

  if (current) sections.push(current);

  return {
    header: trimBlankEdges(header),
    // A CV can repeat a heading ("Experience" per page in a bad export);
    // merging keeps one section per kind rather than silently dropping the rest.
    sections: mergeDuplicateSections(sections),
  };
}

function mergeDuplicateSections(sections: DetectedSection[]): DetectedSection[] {
  const byKind = new Map<CvSection, { section: CvSection; heading: string; lines: string[] }>();

  for (const entry of sections) {
    const existing = byKind.get(entry.section);
    if (existing) {
      existing.lines.push('', ...entry.lines);
    } else {
      byKind.set(entry.section, { ...entry, lines: [...entry.lines] });
    }
  }

  return [...byKind.values()].map((entry) => ({ ...entry, lines: trimBlankEdges(entry.lines) }));
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]) start += 1;
  while (end > start && !lines[end - 1]) end -= 1;
  return lines.slice(start, end);
}

/** Splits a block into bullet lines, tolerating the many bullet glyphs in use. */
export function toBullets(lines: string[]): string[] {
  const bullets: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    const stripped = line.replace(/^[•●▪‣⁃*\-–—+·]\s*/u, '').trim();
    if (stripped) bullets.push(stripped);
  }

  return bullets;
}
