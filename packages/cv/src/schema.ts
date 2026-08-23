import { z } from 'zod';

/*
 * Exposed as `@jobpilot/cv/schema` as well as from the package root.
 *
 * The browser needs these types and this validator; it must not need the
 * renderers. Importing the root pulls in docx, pdf-lib, unpdf and mammoth —
 * server-only libraries that webpack cannot bundle at all (docx uses a dynamic
 * require) and that would be pointless weight in a page even if it could.
 * This file depends on nothing but zod.
 */

/**
 * The structured CV document.
 *
 * One shape serves the master CV, every tailored version, the editor and both
 * renderers. Tailoring produces a new `CvDocument` from an existing one, which
 * is what makes the anti-fabrication check in Phase 6 possible: two documents
 * of the same shape can be diffed field by field, so any employer, date or
 * qualification that appears in the output but not the input is detectable.
 *
 * Every field except a person's name is optional. Real CVs omit things, and a
 * parser that rejects a CV for having no education section is useless.
 */

/**
 * Dates on CVs are free text: "Jan 2020", "2020-03", "Present", "Summer 2019".
 * The raw string is preserved for display and round-tripping; the parsed parts
 * are best-effort and used for sorting. Never invent a month that was not
 * written down.
 */
export const CvDateSchema = z.object({
  raw: z.string().trim().max(60),
  year: z.number().int().min(1900).max(2200).optional(),
  month: z.number().int().min(1).max(12).optional(),
});
export type CvDate = z.infer<typeof CvDateSchema>;

export const CvLinkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url().max(500),
});
export type CvLink = z.infer<typeof CvLinkSchema>;

export const CvPersonalInfoSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  headline: z.string().trim().max(160).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(120).optional(),
  links: z.array(CvLinkSchema).max(12).default([]),
});
export type CvPersonalInfo = z.infer<typeof CvPersonalInfoSchema>;

export const CvExperienceItemSchema = z.object({
  company: z.string().trim().min(1).max(160),
  title: z.string().trim().max(160).default(''),
  location: z.string().trim().max(120).optional(),
  startDate: CvDateSchema.optional(),
  endDate: CvDateSchema.optional(),
  isCurrent: z.boolean().default(false),
  /** Achievement lines. Tailoring rewrites these; it never adds new roles. */
  bullets: z.array(z.string().trim().min(1).max(600)).max(30).default([]),
});
export type CvExperienceItem = z.infer<typeof CvExperienceItemSchema>;

export const CvEducationItemSchema = z.object({
  institution: z.string().trim().min(1).max(160),
  qualification: z.string().trim().max(160).optional(),
  field: z.string().trim().max(160).optional(),
  startDate: CvDateSchema.optional(),
  endDate: CvDateSchema.optional(),
  grade: z.string().trim().max(80).optional(),
  bullets: z.array(z.string().trim().min(1).max(600)).max(15).default([]),
});
export type CvEducationItem = z.infer<typeof CvEducationItemSchema>;

export const CvProjectItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  url: z.string().trim().url().max(500).optional(),
  technologies: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  bullets: z.array(z.string().trim().min(1).max(600)).max(20).default([]),
});
export type CvProjectItem = z.infer<typeof CvProjectItemSchema>;

export const CvCertificationItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  issuer: z.string().trim().max(160).optional(),
  issuedAt: CvDateSchema.optional(),
  expiresAt: CvDateSchema.optional(),
  credentialUrl: z.string().trim().url().max(500).optional(),
});
export type CvCertificationItem = z.infer<typeof CvCertificationItemSchema>;

/**
 * Skills are grouped rather than a flat list, because that is how CVs present
 * them ("Languages: Python, Go") and templates need the grouping to render.
 * An ungrouped list is a single group with no category.
 */
export const CvSkillGroupSchema = z.object({
  category: z.string().trim().max(80).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(120).default([]),
});
export type CvSkillGroup = z.infer<typeof CvSkillGroupSchema>;

/** Section identifiers, also used for template ordering. */
export const CV_SECTIONS = [
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'achievements',
] as const;

export const CvSectionSchema = z.enum(CV_SECTIONS);
export type CvSection = z.infer<typeof CvSectionSchema>;

export const CvDocumentSchema = z.object({
  personal: CvPersonalInfoSchema,
  summary: z.string().trim().max(3000).optional(),
  skillGroups: z.array(CvSkillGroupSchema).max(20).default([]),
  experience: z.array(CvExperienceItemSchema).max(40).default([]),
  education: z.array(CvEducationItemSchema).max(20).default([]),
  projects: z.array(CvProjectItemSchema).max(40).default([]),
  certifications: z.array(CvCertificationItemSchema).max(40).default([]),
  achievements: z.array(z.string().trim().min(1).max(600)).max(40).default([]),
  /**
   * Presentation order. Tailoring may reorder sections to put the most
   * relevant material first — that is a legitimate change, unlike inventing
   * content.
   */
  sectionOrder: z.array(CvSectionSchema).max(CV_SECTIONS.length).default([...CV_SECTIONS]),
});
export type CvDocument = z.infer<typeof CvDocumentSchema>;

/** An empty but valid document, used as the editor's starting point. */
export function emptyCvDocument(fullName = 'Your Name'): CvDocument {
  return CvDocumentSchema.parse({ personal: { fullName } });
}

/**
 * Flattens every skill across groups. Used by matching and by the
 * anti-fabrication check, which needs one comparable set.
 */
export function allSkills(document: CvDocument): string[] {
  return document.skillGroups.flatMap((group) => group.skills);
}

/** Every distinct employer named in the CV, lower-cased for comparison. */
export function allEmployers(document: CvDocument): string[] {
  return [...new Set(document.experience.map((item) => item.company.toLowerCase()))];
}
