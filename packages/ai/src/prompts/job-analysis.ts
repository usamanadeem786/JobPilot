import type { CvDocument } from '@jobpilot/cv';
import { allSkills } from '@jobpilot/cv';
import { z } from 'zod';
import type { StructuredRequest } from '../types';

/**
 * Job relevance analysis.
 *
 * Prompts live in versioned modules rather than inline strings, so the version
 * can be stored alongside every result. Without that, changing a prompt
 * silently invalidates every score already in the database with no way to tell
 * which rows came from which wording.
 */

export const JOB_ANALYSIS_PROMPT_ID = 'jobAnalysis';
export const JOB_ANALYSIS_PROMPT_VERSION = '1.0.0';

export const MatchRecommendationSchema = z.enum([
  'STRONG_MATCH',
  'GOOD_MATCH',
  'POSSIBLE_MATCH',
  'WEAK_MATCH',
  'NOT_RECOMMENDED',
]);

export const JobAnalysisResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  matchingSkills: z.array(z.string().trim().min(1).max(80)).max(40),
  missingSkills: z.array(z.string().trim().min(1).max(80)).max(40),
  matchingExperience: z.array(z.string().trim().min(1).max(300)).max(20),
  missingExperience: z.array(z.string().trim().min(1).max(300)).max(20),
  recommendation: MatchRecommendationSchema,
  reason: z.string().trim().min(1).max(1200),
});

export type JobAnalysisResult = z.infer<typeof JobAnalysisResultSchema>;

const SYSTEM = `You assess how well a candidate's CV matches a job description.

Rules you must follow:
- Judge ONLY on what the CV actually contains. Never assume a skill the CV does not mention, however likely it seems for someone with this background.
- "matchingSkills" must contain only skills that appear in BOTH the CV and the job description.
- "missingSkills" must contain only requirements stated in the job description that the CV does not evidence.
- Do not infer seniority, tenure or education that is not written down.
- If the job description is vague, say so in "reason" and score conservatively.
- Reply with a single JSON object and nothing else. No prose, no code fences.`;

export interface JobAnalysisInput {
  readonly cv: CvDocument;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly jobDescription: string;
  readonly jobLocation?: string;
}

/**
 * The CV is summarised into the fields that matter for matching rather than
 * pasted whole. A full CV is mostly formatting, and the token budget is better
 * spent on the job description, which is the part that varies per call.
 */
export function buildJobAnalysisPrompt(
  input: JobAnalysisInput,
): StructuredRequest<typeof JobAnalysisResultSchema> {
  const skills = allSkills(input.cv);

  const experience = input.cv.experience
    .map((role) => {
      const period = [role.startDate?.raw, role.isCurrent ? 'Present' : role.endDate?.raw]
        .filter(Boolean)
        .join(' - ');
      const bullets = role.bullets.map((bullet) => `    - ${bullet}`).join('\n');
      return `  ${role.title || 'Role'} at ${role.company}${period ? ` (${period})` : ''}\n${bullets}`;
    })
    .join('\n');

  const education = input.cv.education
    .map((item) =>
      `  ${item.qualification ?? 'Qualification'}${item.field ? ` in ${item.field}` : ''}, ${item.institution}`,
    )
    .join('\n');

  const user = `CANDIDATE CV
Headline: ${input.cv.personal.headline ?? '(none stated)'}
Summary: ${input.cv.summary ?? '(none stated)'}

Skills listed on the CV:
${skills.length > 0 ? skills.join(', ') : '(none listed)'}

Experience:
${experience || '  (none listed)'}

Education:
${education || '  (none listed)'}

Certifications:
${input.cv.certifications.map((item) => `  ${item.name}`).join('\n') || '  (none listed)'}

JOB
Title: ${input.jobTitle}
Company: ${input.companyName}
Location: ${input.jobLocation ?? '(not stated)'}

Description:
${input.jobDescription.slice(0, 8000)}

Return JSON matching exactly this shape:
{
  "score": 0-100,
  "matchingSkills": ["..."],
  "missingSkills": ["..."],
  "matchingExperience": ["..."],
  "missingExperience": ["..."],
  "recommendation": "STRONG_MATCH" | "GOOD_MATCH" | "POSSIBLE_MATCH" | "WEAK_MATCH" | "NOT_RECOMMENDED",
  "reason": "two or three sentences explaining the score"
}`;

  return {
    promptId: JOB_ANALYSIS_PROMPT_ID,
    promptVersion: JOB_ANALYSIS_PROMPT_VERSION,
    system: SYSTEM,
    user,
    schema: JobAnalysisResultSchema,
    maxOutputTokens: 1_500,
    temperature: 0.1,
  };
}
