import { allSkills, type CvDocument } from '@jobpilot/cv';
import type { JobAnalysisResult } from '../prompts/job-analysis';

/**
 * A deterministic job matcher.
 *
 * Runs with no API key, no network and no cost, and is the reason match scores
 * work at all on a deployment with no LLM configured. It is also the baseline
 * the LLM is measured against: a model that scores worse than counting skill
 * overlaps is not earning its tokens.
 *
 * It scores only what can be checked mechanically — does the CV list this
 * skill, does the title match, is the seniority compatible — and says so. It
 * never claims to understand the role, which is what the LLM path adds.
 */

export interface HeuristicInput {
  readonly cv: CvDocument;
  readonly jobTitle: string;
  readonly jobDescription: string;
  readonly jobLocation?: string;
  readonly remoteType?: string;
  readonly experienceLevel?: string;
}

/**
 * Weights sum to 100. Skills dominate because they are the most reliably
 * stated on both sides; the description-derived signals are noisier and
 * weighted accordingly.
 */
const WEIGHTS = {
  skills: 55,
  title: 20,
  seniority: 15,
  location: 10,
} as const;

/**
 * Skill vocabulary used to find requirements in a job description.
 *
 * A curated list rather than free-text extraction: without one, "experience"
 * and "team" register as skills and every job matches every CV. Terms not on
 * this list are simply not scored, which is a known limitation rather than a
 * silent wrong answer — and the reason the LLM path exists.
 */
const SKILL_VOCABULARY = [
  // Languages
  'python', 'typescript', 'javascript', 'java', 'go', 'golang', 'rust', 'c#', 'c++', 'ruby',
  'php', 'kotlin', 'swift', 'scala', 'elixir', 'sql', 'bash',
  // Backend frameworks
  'django', 'fastapi', 'flask', 'nestjs', 'express', 'spring', 'rails', 'laravel', 'celery',
  'graphql', 'grpc', 'rest',
  // Frontend
  'react', 'next.js', 'nextjs', 'vue', 'angular', 'svelte', 'tailwind', 'redux',
  // Data
  'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'kafka', 'rabbitmq',
  'snowflake', 'bigquery', 'spark', 'airflow', 'dbt', 'pandas', 'numpy',
  // Cloud and platform
  'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins',
  'github actions', 'gitlab ci', 'ci/cd', 'linux', 'nginx', 'serverless', 'lambda',
  // Practice
  'microservices', 'tdd', 'pytest', 'jest', 'agile', 'scrum', 'rest api', 'oauth',
  'machine learning', 'llm', 'pytorch', 'tensorflow',
] as const;

const SENIORITY_ORDER = [
  'INTERNSHIP',
  'ENTRY',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
  'PRINCIPAL',
  'EXECUTIVE',
] as const;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#./ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Matches a skill as a whole term, so "go" does not match "django" and "r"
 * does not match every word containing it.
 */
function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i').test(haystack);
}

/** Skills the job description asks for, limited to the known vocabulary. */
export function extractRequiredSkills(jobDescription: string): string[] {
  const text = normalise(jobDescription);
  return SKILL_VOCABULARY.filter((skill) => mentions(text, skill));
}

/** Everything the CV evidences anywhere, not only its skills section. */
export function cvEvidence(cv: CvDocument): string {
  return normalise(
    [
      allSkills(cv).join(' '),
      cv.summary ?? '',
      cv.personal.headline ?? '',
      cv.experience.flatMap((role) => [role.title, ...role.bullets]).join(' '),
      cv.projects.flatMap((project) => [project.name, project.description ?? '', ...project.technologies, ...project.bullets]).join(' '),
      cv.certifications.map((item) => item.name).join(' '),
    ].join(' '),
  );
}

function titleOverlap(cvTitles: string[], jobTitle: string): number {
  const jobTokens = new Set(normalise(jobTitle).split(' ').filter((token) => token.length > 2));
  if (jobTokens.size === 0) return 0;

  let best = 0;
  for (const title of cvTitles) {
    const tokens = new Set(normalise(title).split(' ').filter((token) => token.length > 2));
    if (tokens.size === 0) continue;

    let shared = 0;
    for (const token of tokens) if (jobTokens.has(token)) shared += 1;
    best = Math.max(best, shared / jobTokens.size);
  }

  return best;
}

/**
 * Seniority compatibility. Being one level above the ask is fine; being two
 * levels below is not, and the asymmetry matters — a senior engineer can do a
 * mid role, but the reverse is what gets an application rejected.
 */
function seniorityFit(cvLevel: string | undefined, jobLevel: string | undefined): number {
  if (!cvLevel || !jobLevel || cvLevel === 'UNKNOWN' || jobLevel === 'UNKNOWN') return 0.5;

  const cvIndex = SENIORITY_ORDER.indexOf(cvLevel as (typeof SENIORITY_ORDER)[number]);
  const jobIndex = SENIORITY_ORDER.indexOf(jobLevel as (typeof SENIORITY_ORDER)[number]);
  if (cvIndex < 0 || jobIndex < 0) return 0.5;

  const gap = cvIndex - jobIndex;
  if (gap === 0) return 1;
  if (gap === 1) return 0.85;
  if (gap === -1) return 0.6;
  if (gap > 1) return 0.5;
  return 0.2;
}

function locationFit(cv: CvDocument, jobLocation: string | undefined, remoteType: string | undefined): number {
  if (remoteType === 'REMOTE') return 1;
  if (!jobLocation) return 0.5;

  const candidate = normalise(
    [cv.personal.location ?? '', ...(cv.personal.headline ? [cv.personal.headline] : [])].join(' '),
  );
  if (!candidate) return 0.5;

  const job = normalise(jobLocation);
  const shares = job.split(' ').some((token) => token.length > 3 && candidate.includes(token));
  return shares ? 1 : 0.3;
}

/** Infers the candidate's level from their most recent title. */
function candidateLevel(cv: CvDocument): string | undefined {
  const title = cv.experience[0]?.title ?? cv.personal.headline ?? '';
  const text = title.toLowerCase();

  if (/\bintern(ship)?\b/.test(text)) return 'INTERNSHIP';
  if (/\b(chief|cto|vp|head of)\b/.test(text)) return 'EXECUTIVE';
  if (/\bprincipal\b/.test(text)) return 'PRINCIPAL';
  if (/\b(staff|lead)\b/.test(text)) return 'LEAD';
  if (/\b(senior|snr|sr\.?)\b/.test(text)) return 'SENIOR';
  if (/\b(junior|jnr|jr\.?|graduate)\b/.test(text)) return 'JUNIOR';
  return undefined;
}

export function analyseHeuristically(input: HeuristicInput): JobAnalysisResult {
  const required = extractRequiredSkills(`${input.jobTitle} ${input.jobDescription}`);
  const evidence = cvEvidence(input.cv);

  const matchingSkills = required.filter((skill) => mentions(evidence, skill));
  const missingSkills = required.filter((skill) => !mentions(evidence, skill));

  // With no recognisable requirements there is nothing to score against, so
  // the skills component is neutral rather than zero — otherwise a vague
  // description would score every candidate at nearly nothing.
  const skillsRatio = required.length === 0 ? 0.5 : matchingSkills.length / required.length;

  const titleRatio = titleOverlap(
    [...input.cv.experience.map((role) => role.title), input.cv.personal.headline ?? ''].filter(Boolean),
    input.jobTitle,
  );

  const seniorityRatio = seniorityFit(candidateLevel(input.cv), input.experienceLevel);
  const locationRatio = locationFit(input.cv, input.jobLocation, input.remoteType);

  const score = Math.round(
    skillsRatio * WEIGHTS.skills +
      titleRatio * WEIGHTS.title +
      seniorityRatio * WEIGHTS.seniority +
      locationRatio * WEIGHTS.location,
  );

  const matchingExperience = input.cv.experience
    .filter((role) => titleOverlap([role.title], input.jobTitle) >= 0.4)
    .map((role) => `${role.title} at ${role.company}`)
    .slice(0, 5);

  return {
    score: Math.max(0, Math.min(100, score)),
    matchingSkills,
    missingSkills,
    matchingExperience,
    // Left empty deliberately: judging which experience is MISSING needs an
    // understanding of the role that counting keywords does not provide.
    // Claiming otherwise would be presenting a gap in the method as a gap in
    // the candidate.
    missingExperience: [],
    recommendation: toRecommendation(score),
    reason: buildReason(matchingSkills, missingSkills, required.length, titleRatio),
  };
}

function toRecommendation(score: number): JobAnalysisResult['recommendation'] {
  if (score >= 80) return 'STRONG_MATCH';
  if (score >= 65) return 'GOOD_MATCH';
  if (score >= 45) return 'POSSIBLE_MATCH';
  if (score >= 25) return 'WEAK_MATCH';
  return 'NOT_RECOMMENDED';
}

function buildReason(
  matching: string[],
  missing: string[],
  requiredCount: number,
  titleRatio: number,
): string {
  if (requiredCount === 0) {
    return 'This description lists no recognisable technical requirements, so the score reflects title and seniority only. Read the description before relying on it.';
  }

  const parts = [
    `Your CV evidences ${matching.length} of ${requiredCount} recognised requirements` +
      (matching.length > 0 ? ` (${matching.slice(0, 6).join(', ')})` : ''),
  ];

  if (missing.length > 0) {
    parts.push(`It does not evidence ${missing.slice(0, 6).join(', ')}`);
  }

  parts.push(
    titleRatio >= 0.6
      ? 'Your job titles closely match this role'
      : titleRatio >= 0.3
        ? 'Your job titles partly match this role'
        : 'Your job titles differ from this role',
  );

  return `${parts.join('. ')}. Counted from keywords only, without reading the role in context.`;
}
