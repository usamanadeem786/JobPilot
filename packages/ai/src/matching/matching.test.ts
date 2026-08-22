import { CvDocumentSchema, type CvDocument } from '@jobpilot/cv';
import { describe, expect, it, vi } from 'vitest';
import { LlmService } from '../llm.service';
import { MockLlmProvider } from '../providers/mock';
import { analyseHeuristically, cvEvidence, extractRequiredSkills } from './heuristic';
import { JobMatchingService } from './service';

const pythonCv: CvDocument = CvDocumentSchema.parse({
  personal: { fullName: 'Usama Nadeem', headline: 'Senior Python Backend Developer', location: 'Lahore, Pakistan' },
  summary: 'Backend engineer building Django and FastAPI services.',
  skillGroups: [
    { category: 'Languages', skills: ['Python', 'TypeScript', 'SQL'] },
    { category: 'Frameworks', skills: ['Django', 'FastAPI'] },
    { category: 'Data', skills: ['PostgreSQL', 'Redis'] },
  ],
  experience: [
    {
      company: 'Acme Systems',
      title: 'Senior Backend Engineer',
      isCurrent: true,
      bullets: ['Migrated a Django monolith to FastAPI services', 'Ran the deployment pipeline on AWS with Docker'],
    },
  ],
});

const PYTHON_JOB = {
  jobTitle: 'Senior Backend Engineer',
  companyName: 'Globex',
  jobDescription:
    'We are looking for a Senior Backend Engineer with strong Python and Django experience. ' +
    'You will build REST APIs backed by PostgreSQL, deploy with Docker on AWS, and work with Redis for caching. ' +
    'Kubernetes experience is a plus.',
  experienceLevel: 'SENIOR',
};

const FRONTEND_JOB = {
  jobTitle: 'Senior React Developer',
  companyName: 'Initech',
  jobDescription:
    'Build user interfaces with React, Redux and Tailwind. Strong JavaScript and CSS skills required. ' +
    'Experience with Vue or Angular welcome.',
  experienceLevel: 'SENIOR',
};

describe('extractRequiredSkills', () => {
  it('finds skills that are actually named', () => {
    const skills = extractRequiredSkills(PYTHON_JOB.jobDescription);
    expect(skills).toEqual(expect.arrayContaining(['python', 'django', 'postgresql', 'docker', 'aws', 'redis']));
  });

  it('does not treat filler words as skills', () => {
    // Free-text extraction registers "experience" and "team" as requirements,
    // and then every job matches every CV.
    const skills = extractRequiredSkills('We want a motivated team player with great experience and communication.');
    expect(skills).toEqual([]);
  });

  it('matches whole terms, so "go" does not match "django"', () => {
    expect(extractRequiredSkills('We use Django here.')).not.toContain('go');
    expect(extractRequiredSkills('We write services in Go.')).toContain('go');
  });
});

describe('cvEvidence', () => {
  it('includes skills demonstrated in bullets, not only the skills section', () => {
    const evidence = cvEvidence(pythonCv);
    expect(evidence).toContain('docker');
    expect(evidence).toContain('aws');
  });
});

describe('analyseHeuristically', () => {
  it('scores a well-matched job highly', () => {
    const result = analyseHeuristically({ cv: pythonCv, ...PYTHON_JOB });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(['STRONG_MATCH', 'GOOD_MATCH']).toContain(result.recommendation);
  });

  it('scores an unrelated job much lower', () => {
    const python = analyseHeuristically({ cv: pythonCv, ...PYTHON_JOB });
    const frontend = analyseHeuristically({ cv: pythonCv, ...FRONTEND_JOB });
    expect(frontend.score).toBeLessThan(python.score - 20);
  });

  it('lists only skills the CV actually evidences as matching', () => {
    const result = analyseHeuristically({ cv: pythonCv, ...PYTHON_JOB });
    expect(result.matchingSkills).toEqual(expect.arrayContaining(['python', 'django', 'postgresql']));
    // Kubernetes is asked for and the CV does not mention it.
    expect(result.missingSkills).toContain('kubernetes');
    expect(result.matchingSkills).not.toContain('kubernetes');
  });

  it('never claims a missing skill is present', () => {
    const result = analyseHeuristically({ cv: pythonCv, ...FRONTEND_JOB });
    for (const skill of result.matchingSkills) {
      expect(cvEvidence(pythonCv)).toContain(skill);
    }
  });

  it('leaves missingExperience empty rather than guessing', () => {
    // Judging which experience is absent needs an understanding of the role
    // that keyword counting does not have. Filling it would present a gap in
    // the method as a gap in the candidate.
    expect(analyseHeuristically({ cv: pythonCv, ...PYTHON_JOB }).missingExperience).toEqual([]);
  });

  it('says so when a description lists no recognisable requirements', () => {
    const result = analyseHeuristically({
      cv: pythonCv,
      jobTitle: 'Backend Engineer',
      companyName: 'X',
      jobDescription: 'Join our fast-paced team and make an impact.',
    });
    expect(result.reason).toContain('no recognisable technical requirements');
  });

  it('states that the score came from keywords', () => {
    // The reason text is what stops a number being read as a judgement.
    expect(analyseHeuristically({ cv: pythonCv, ...PYTHON_JOB }).reason).toContain('keywords only');
  });

  it('penalises a role two seniority levels above the candidate', () => {
    const junior = CvDocumentSchema.parse({
      ...pythonCv,
      personal: { ...pythonCv.personal, headline: 'Junior Python Developer' },
      experience: [{ company: 'Acme', title: 'Junior Developer', isCurrent: true, bullets: [] }],
    });

    const seniorFit = analyseHeuristically({ cv: pythonCv, ...PYTHON_JOB });
    const juniorFit = analyseHeuristically({ cv: junior, ...PYTHON_JOB });
    expect(juniorFit.score).toBeLessThan(seniorFit.score);
  });

  it('produces a score in range for an empty CV', () => {
    const empty = CvDocumentSchema.parse({ personal: { fullName: 'Nobody' } });
    const result = analyseHeuristically({ cv: empty, ...PYTHON_JOB });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.matchingSkills).toEqual([]);
  });
});

describe('JobMatchingService', () => {
  const heuristic = (input: Parameters<typeof analyseHeuristically>[0]) => analyseHeuristically(input);
  const now = () => new Date('2026-08-22T12:00:00Z');

  it('uses the heuristic when no provider is configured', async () => {
    const llm = new LlmService({
      name: 'none',
      defaultModel: 'x',
      isConfigured: () => false,
      complete: () => Promise.reject(new Error('unreachable')),
    });

    const result = await new JobMatchingService(llm, heuristic, { now }).analyse({
      cv: pythonCv,
      ...PYTHON_JOB,
    });

    expect(result.method).toBe('heuristic');
    expect(result.promptVersion).toBeNull();
    expect(result.fellBackBecause).toBeNull();
  });

  it('uses the LLM when one is configured, and records the prompt version', async () => {
    const provider = new MockLlmProvider([
      JSON.stringify({
        score: 91,
        matchingSkills: ['Python'],
        missingSkills: [],
        matchingExperience: [],
        missingExperience: [],
        recommendation: 'STRONG_MATCH',
        reason: 'Excellent overlap.',
      }),
    ]);

    const result = await new JobMatchingService(new LlmService(provider), heuristic, { now }).analyse({
      cv: pythonCv,
      ...PYTHON_JOB,
    });

    expect(result.method).toBe('llm');
    expect(result.score).toBe(91);
    expect(result.promptVersion).toBe('1.0.0');
  });

  it('falls back to the heuristic when the LLM fails, and says why', async () => {
    // 200 jobs with clearly-labelled keyword scores beats 200 jobs with no
    // scores because a provider had a bad minute.
    const failing = new LlmService(
      {
        name: 'flaky',
        defaultModel: 'x',
        isConfigured: () => true,
        complete: () => Promise.reject(new Error('upstream 503')),
      },
      { maxRetries: 0 },
    );

    const warn = vi.fn();
    const result = await new JobMatchingService(failing, heuristic, { now, logger: { warn } }).analyse({
      cv: pythonCv,
      ...PYTHON_JOB,
    });

    expect(result.method).toBe('heuristic');
    expect(result.fellBackBecause).toContain('upstream 503');
    expect(warn).toHaveBeenCalled();
  });

  it('falls back when the model returns unverifiable output', async () => {
    const invalid = new LlmService(new MockLlmProvider(['not json']), { maxRetries: 0 });

    const result = await new JobMatchingService(invalid, heuristic, { now }).analyse({
      cv: pythonCv,
      ...PYTHON_JOB,
    });

    expect(result.method).toBe('heuristic');
    expect(result.fellBackBecause).toContain('could not be verified');
  });

  it('analyses many jobs with bounded concurrency, preserving order', async () => {
    let active = 0;
    let peak = 0;

    const slow = new LlmService({
      name: 'slow',
      defaultModel: 'm',
      isConfigured: () => true,
      complete: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          text: JSON.stringify({
            score: 50,
            matchingSkills: [],
            missingSkills: [],
            matchingExperience: [],
            missingExperience: [],
            recommendation: 'POSSIBLE_MATCH',
            reason: 'ok',
          }),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          model: 'm',
        };
      },
    });

    const inputs = Array.from({ length: 12 }, (_, index) => ({
      cv: pythonCv,
      jobTitle: `Job ${index}`,
      companyName: 'X',
      jobDescription: 'Python',
    }));

    const progress: number[] = [];
    const results = await new JobMatchingService(slow, heuristic, { now }).analyseMany(
      inputs,
      3,
      (completed) => progress.push(completed),
    );

    expect(results).toHaveLength(12);
    expect(results.every((entry) => entry.method === 'llm')).toBe(true);
    // Firing all twelve at once is how a provider rate-limits an account.
    expect(peak).toBeLessThanOrEqual(3);
    expect(progress.at(-1)).toBe(12);
  });
});
