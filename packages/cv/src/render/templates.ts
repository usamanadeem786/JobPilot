import type { CvSection } from '../schema';

/**
 * CV templates.
 *
 * A template is a style configuration, not a separate renderer. One DOCX
 * writer and one PDF writer read these values, so a new template is a data
 * entry rather than a fifth copy of the layout code — and a fix to text
 * wrapping benefits all of them at once.
 *
 * Every template is single-column with real headings and no tables, text
 * boxes or graphics. Applicant tracking systems parse those badly or not at
 * all, and a CV that looks good and parses to nothing is worse than a plain
 * one that parses cleanly.
 */

export interface TemplateStyle {
  readonly key: string;
  readonly name: string;
  readonly description: string;

  readonly fontFamily: 'Helvetica' | 'Times';
  readonly baseFontSize: number;
  readonly nameFontSize: number;
  readonly headingFontSize: number;

  /** Hex, no leading hash. Used sparingly: colour does not survive ATS text extraction. */
  readonly accentColour: string;
  readonly headingUppercase: boolean;
  readonly headingRule: boolean;

  readonly lineSpacing: number;
  readonly sectionSpacing: number;
  readonly marginPoints: number;

  /** Default section order; a tailored CV may override it. */
  readonly sectionOrder: readonly CvSection[];
}

const STANDARD_ORDER: readonly CvSection[] = [
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'achievements',
];

export const CV_TEMPLATES: readonly TemplateStyle[] = [
  {
    key: 'modern-ats',
    name: 'Modern ATS',
    description: 'Clean single column tuned for applicant tracking systems. The safe default.',
    fontFamily: 'Helvetica',
    baseFontSize: 10.5,
    nameFontSize: 20,
    headingFontSize: 11.5,
    accentColour: '1F4E79',
    headingUppercase: true,
    headingRule: true,
    lineSpacing: 1.15,
    sectionSpacing: 10,
    marginPoints: 54,
    sectionOrder: STANDARD_ORDER,
  },
  {
    key: 'professional',
    name: 'Professional',
    description: 'Traditional serif layout for finance, law and consulting.',
    fontFamily: 'Times',
    baseFontSize: 11,
    nameFontSize: 19,
    headingFontSize: 12,
    accentColour: '000000',
    headingUppercase: true,
    headingRule: true,
    lineSpacing: 1.2,
    sectionSpacing: 11,
    marginPoints: 63,
    sectionOrder: STANDARD_ORDER,
  },
  {
    key: 'minimal',
    name: 'Minimal',
    description: 'Maximum content per page. Useful when experience runs long.',
    fontFamily: 'Helvetica',
    baseFontSize: 10,
    nameFontSize: 16,
    headingFontSize: 10.5,
    accentColour: '333333',
    headingUppercase: false,
    headingRule: false,
    lineSpacing: 1.05,
    sectionSpacing: 7,
    marginPoints: 40,
    sectionOrder: STANDARD_ORDER,
  },
  {
    key: 'software-engineer',
    name: 'Software Engineer',
    description: 'Skills and projects promoted above education, which is how engineering CVs are read.',
    fontFamily: 'Helvetica',
    baseFontSize: 10.5,
    nameFontSize: 18,
    headingFontSize: 11,
    accentColour: '0B6E4F',
    headingUppercase: true,
    headingRule: true,
    lineSpacing: 1.15,
    sectionSpacing: 9,
    marginPoints: 50,
    // Skills first: for engineering roles the stack is the screening filter.
    sectionOrder: ['summary', 'skills', 'experience', 'projects', 'certifications', 'education', 'achievements'],
  },
  {
    key: 'executive',
    name: 'Executive',
    description: 'Summary and achievements led, for senior and leadership roles.',
    fontFamily: 'Times',
    baseFontSize: 11,
    nameFontSize: 22,
    headingFontSize: 12.5,
    accentColour: '111111',
    headingUppercase: true,
    headingRule: true,
    lineSpacing: 1.25,
    sectionSpacing: 12,
    marginPoints: 63,
    sectionOrder: ['summary', 'achievements', 'experience', 'skills', 'education', 'certifications', 'projects'],
  },
];

export const DEFAULT_TEMPLATE_KEY = 'modern-ats';

export function getTemplate(key: string | undefined): TemplateStyle {
  return (
    CV_TEMPLATES.find((template) => template.key === key) ??
    (CV_TEMPLATES.find((template) => template.key === DEFAULT_TEMPLATE_KEY) as TemplateStyle)
  );
}

/** Human-readable section headings, shared by both renderers. */
export const SECTION_HEADINGS: Record<CvSection, string> = {
  summary: 'Professional Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  achievements: 'Achievements',
};
