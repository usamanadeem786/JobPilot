import { z } from 'zod';
import type { CvDocument } from '@jobpilot/cv';
import type { StructuredRequest } from '../types';

/**
 * Drafting an introduction to a hiring contact.
 *
 * The constraint that shapes this prompt: the message may only contain facts
 * from the applicant's own CV. A cover note that overstates experience is
 * worse than no note at all — it is the applicant's reputation being spent,
 * and they may not notice the exaggeration before sending it.
 */

export const OUTREACH_PROMPT_ID = 'outreach';
export const OUTREACH_PROMPT_VERSION = '1.0.0';

export const OutreachResultSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4_000),
  /** Claims made, so they can be checked against the CV before sending. */
  claimsMade: z.array(z.string().trim().min(1).max(300)).max(20),
});

export type OutreachResult = z.infer<typeof OutreachResultSchema>;

const SYSTEM = `You write a short introduction from a job applicant to a hiring contact.

Rules you must follow:
- Use ONLY facts present in the applicant's CV. Invent nothing: no employers,
  titles, dates, qualifications, metrics or projects that are not there.
- Do not claim enthusiasm for, or knowledge of, the company beyond what the
  job description states.
- Do not promise availability, salary expectations or notice periods.
- Keep it under 180 words. A hiring contact reads dozens of these.
- No flattery, no "I am writing to express my keen interest", no invented
  personal connection.
- Address the person by name only if you were given one.
- List every factual claim you made in "claimsMade", so it can be checked.

Reply with a single JSON object and nothing else. No prose, no code fences.`;

export interface OutreachPromptInput {
  readonly cv: CvDocument;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly jobDescription: string;
  readonly contactName: string | null;
  readonly tone: 'professional' | 'warm' | 'brief';
}

export function buildOutreachPrompt(
  input: OutreachPromptInput,
): StructuredRequest<typeof OutreachResultSchema> {
  const user = `APPLICANT CV (the only facts you may use)
${JSON.stringify(input.cv, null, 2)}

TARGET ROLE
Title: ${input.jobTitle}
Company: ${input.companyName}
Contact: ${input.contactName ?? '(name not known — do not invent one)'}
Tone: ${input.tone}

Description:
${input.jobDescription.slice(0, 4000)}

Return JSON of exactly this shape:
{
  "subject": "...",
  "body": "...",
  "claimsMade": ["..."]
}`;

  return {
    promptId: OUTREACH_PROMPT_ID,
    promptVersion: OUTREACH_PROMPT_VERSION,
    system: SYSTEM,
    user,
    schema: OutreachResultSchema,
    maxOutputTokens: 1_200,
    temperature: 0.3,
  };
}
