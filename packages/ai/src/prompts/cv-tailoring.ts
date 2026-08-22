import { CvDocumentSchema, type CvDocument } from '@jobpilot/cv';
import { z } from 'zod';
import type { StructuredRequest } from '../types';

/**
 * CV tailoring.
 *
 * The single most dangerous prompt in the product: it produces a document a
 * person will send to an employer with their name on it. The instructions
 * below are the first line of defence against fabrication, and the validator
 * in @jobpilot/cv is the second — the prompt asks the model not to invent
 * things, and the validator refuses to save the result if it did anyway.
 */

export const CV_TAILORING_PROMPT_ID = 'cvTailoring';
export const CV_TAILORING_PROMPT_VERSION = '1.0.0';

export const ChangeSummarySchema = z.object({
  keywordsEmphasised: z.array(z.string().trim().min(1).max(80)).max(40),
  experienceEmphasised: z.array(z.string().trim().min(1).max(300)).max(20),
  skillsMatched: z.array(z.string().trim().min(1).max(80)).max(40),
  /** Job requirements the CV does not evidence. Reported, never invented. */
  requirementsNotEvidenced: z.array(z.string().trim().min(1).max(300)).max(20),
  sectionsReordered: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
});

export type ChangeSummary = z.infer<typeof ChangeSummarySchema>;

export const CvTailoringResultSchema = z.object({
  document: CvDocumentSchema,
  changeSummary: ChangeSummarySchema,
});

export type CvTailoringResult = z.infer<typeof CvTailoringResultSchema>;

const SYSTEM = `You tailor an existing CV to a specific job description.

You may:
- Rewrite bullet points to use the job's terminology, where the underlying fact is unchanged.
- Reorder sections, roles and bullets so the most relevant material appears first.
- Rewrite the professional summary to target this role.
- Drop bullets that are irrelevant to this job.
- Regroup skills the CV already lists.

You must NEVER:
- Add an employer, job title, date, qualification, certification, project or award that is not in the source CV.
- Add a skill the source CV does not list.
- Change any date, company name or job title.
- Inflate scope, seniority or numbers. If a bullet says "team of 4", it stays 4.
- Invent metrics. If the source has no percentage, the output has no percentage.

If the job requires something the CV does not evidence, list it in
"requirementsNotEvidenced". Do not add it to the CV to close the gap. Every
fact in your output must be traceable to the source CV.

Reply with a single JSON object and nothing else. No prose, no code fences.`;

export interface CvTailoringInput {
  readonly cv: CvDocument;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly jobDescription: string;
}

export function buildCvTailoringPrompt(
  input: CvTailoringInput,
): StructuredRequest<typeof CvTailoringResultSchema> {
  const user = `SOURCE CV (the only facts you may use)
${JSON.stringify(input.cv, null, 2)}

TARGET JOB
Title: ${input.jobTitle}
Company: ${input.companyName}

Description:
${input.jobDescription.slice(0, 8000)}

Return JSON of exactly this shape:
{
  "document": { ...the tailored CV, same structure as the source CV... },
  "changeSummary": {
    "keywordsEmphasised": ["..."],
    "experienceEmphasised": ["..."],
    "skillsMatched": ["..."],
    "requirementsNotEvidenced": ["..."],
    "sectionsReordered": true|false,
    "notes": "optional"
  }
}`;

  return {
    promptId: CV_TAILORING_PROMPT_ID,
    promptVersion: CV_TAILORING_PROMPT_VERSION,
    system: SYSTEM,
    user,
    schema: CvTailoringResultSchema,
    // A full CV round-trips through the response, so this needs real headroom.
    maxOutputTokens: 8_000,
    temperature: 0.2,
  };
}
