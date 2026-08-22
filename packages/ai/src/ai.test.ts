import { CvDocumentSchema, type CvDocument } from '@jobpilot/cv';
import { describe, expect, it, vi } from 'vitest';
import { extractJson, LlmService, parseStructured } from './llm.service';
import { buildCvTailoringPrompt, CvTailoringResultSchema } from './prompts/cv-tailoring';
import { buildJobAnalysisPrompt, JobAnalysisResultSchema } from './prompts/job-analysis';
import { createProvider } from './providers/factory';
import { MockLlmProvider } from './providers/mock';
import { OpenAiCompatibleProvider } from './providers/openai-compatible';
import { AiProviderNotConfiguredError, AiResponseInvalidError } from './types';

const cv: CvDocument = CvDocumentSchema.parse({
  personal: { fullName: 'Usama Nadeem' },
  skillGroups: [{ category: 'Languages', skills: ['Python', 'TypeScript'] }],
  experience: [
    {
      company: 'Acme Systems',
      title: 'Senior Backend Engineer',
      startDate: { raw: 'Mar 2022', year: 2022 },
      isCurrent: true,
      bullets: ['Built FastAPI services'],
    },
  ],
});

const validAnalysis = JSON.stringify({
  score: 82,
  matchingSkills: ['Python'],
  missingSkills: ['Kubernetes'],
  matchingExperience: ['Backend APIs'],
  missingExperience: [],
  recommendation: 'GOOD_MATCH',
  reason: 'Strong Python overlap; no Kubernetes evidence.',
});

describe('extractJson', () => {
  it('finds a bare object', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('unwraps a fenced block, which models emit despite instructions', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('ignores prose either side of the object', () => {
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps!')).toBe('{"a":1}');
  });

  it('handles nested objects, which a non-recursive regex cannot', () => {
    expect(extractJson('{"a":{"b":{"c":1}}}')).toBe('{"a":{"b":{"c":1}}}');
  });

  it('is not fooled by braces inside strings', () => {
    expect(extractJson('{"a":"} not the end {"}')).toBe('{"a":"} not the end {"}');
  });

  it('returns null when there is no object', () => {
    expect(extractJson('I cannot help with that.')).toBeNull();
  });
});

describe('parseStructured', () => {
  it('validates against the schema', () => {
    const result = parseStructured(validAnalysis, JobAnalysisResultSchema);
    expect(result.ok).toBe(true);
  });

  it('reports schema violations by path', () => {
    const result = parseStructured(JSON.stringify({ score: 150 }), JobAnalysisResultSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(' ')).toContain('score');
    }
  });

  it('never repairs malformed JSON', () => {
    // Guessing at a broken response is how a CV silently gains content.
    const result = parseStructured('{"score": 80,}', JobAnalysisResultSchema);
    expect(result.ok).toBe(false);
  });
});

describe('LlmService', () => {
  it('refuses to call an unconfigured provider', async () => {
    const service = new LlmService({
      name: 'none',
      defaultModel: 'x',
      isConfigured: () => false,
      complete: () => Promise.reject(new Error('should not be called')),
    });

    await expect(
      service.complete(buildJobAnalysisPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' })),
    ).rejects.toBeInstanceOf(AiProviderNotConfiguredError);
  });

  it('returns validated data and records usage', async () => {
    const usage: unknown[] = [];
    const service = new LlmService(new MockLlmProvider([validAnalysis]), {
      onUsage: (record) => usage.push(record),
    });

    const result = await service.complete(
      buildJobAnalysisPrompt({ cv, jobTitle: 'Backend Engineer', companyName: 'Acme', jobDescription: 'Python' }),
    );

    expect(result.data.score).toBe(82);
    expect(result.promptId).toBe('jobAnalysis');
    expect(result.promptVersion).toBe('1.0.0');
    expect(usage).toHaveLength(1);
  });

  it('retries once with the parse errors fed back, then succeeds', async () => {
    const provider = new MockLlmProvider(['not json at all', validAnalysis]);
    const service = new LlmService(provider);

    const result = await service.complete(
      buildJobAnalysisPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' }),
    );

    expect(result.attempts).toBe(2);
    // The second prompt must explain what was wrong; resending the identical
    // prompt tends to reproduce the identical malformed answer.
    expect(provider.requests[1]?.user).toContain('could not be parsed');
  });

  it('gives up with AiResponseInvalidError rather than saving unverified output', async () => {
    const service = new LlmService(new MockLlmProvider(['nope']), { maxRetries: 1 });

    await expect(
      service.complete(buildJobAnalysisPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' })),
    ).rejects.toBeInstanceOf(AiResponseInvalidError);
  });
});

describe('prompts', () => {
  it('instructs the analyser not to assume unlisted skills', () => {
    const prompt = buildJobAnalysisPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' });
    expect(prompt.system).toContain('Never assume a skill the CV does not mention');
  });

  it('sends the CV summary rather than the whole document for analysis', () => {
    const prompt = buildJobAnalysisPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' });
    expect(prompt.user).toContain('Acme Systems');
    expect(prompt.user).toContain('Python');
  });

  it('truncates a very long job description to protect the token budget', () => {
    const prompt = buildJobAnalysisPrompt({
      cv,
      jobTitle: 'X',
      companyName: 'Y',
      jobDescription: 'x'.repeat(20_000),
    });
    expect(prompt.user.length).toBeLessThan(12_000);
  });

  it('forbids fabrication explicitly in the tailoring prompt', () => {
    const prompt = buildCvTailoringPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' });
    expect(prompt.system).toContain('You must NEVER');
    expect(prompt.system).toContain('Add a skill the source CV does not list');
    expect(prompt.system).toContain('Invent metrics');
  });

  it('gives tailoring room to return a whole CV', () => {
    const prompt = buildCvTailoringPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' });
    expect(prompt.maxOutputTokens).toBeGreaterThanOrEqual(8_000);
  });

  it('keeps temperature low, since these prompts extract facts', () => {
    expect(buildJobAnalysisPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' }).temperature).toBeLessThanOrEqual(0.2);
    expect(buildCvTailoringPrompt({ cv, jobTitle: 'X', companyName: 'Y', jobDescription: 'Z' }).temperature).toBeLessThanOrEqual(0.2);
  });

  it('validates a well-formed tailoring response', () => {
    const response = JSON.stringify({
      document: cv,
      changeSummary: {
        keywordsEmphasised: ['Python'],
        experienceEmphasised: ['Acme Systems'],
        skillsMatched: ['Python'],
        requirementsNotEvidenced: ['Kubernetes'],
        sectionsReordered: true,
      },
    });

    expect(parseStructured(response, CvTailoringResultSchema).ok).toBe(true);
  });
});

describe('provider factory', () => {
  it('defaults to the mock so the app runs with no key', () => {
    expect(createProvider({}).name).toBe('mock');
    expect(createProvider({}).isConfigured()).toBe(true);
  });

  it.each(['openai', 'groq', 'gemini', 'openrouter'])('builds the %s provider', (vendor) => {
    expect(createProvider({ LLM_PROVIDER: vendor }).name).toBe(vendor);
  });

  it('reports a provider as unconfigured when its key is missing', () => {
    expect(createProvider({ LLM_PROVIDER: 'openai' }).isConfigured()).toBe(false);
    expect(createProvider({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }).isConfigured()).toBe(true);
  });

  it('treats a local Ollama as configured without a key', () => {
    expect(createProvider({ LLM_PROVIDER: 'ollama' }).isConfigured()).toBe(true);
  });

  it('never silently substitutes a provider for an unknown name', () => {
    // Falling back to the mock here would look like working AI returning
    // fixtures, which is worse than a clear failure.
    const provider = createProvider({ LLM_PROVIDER: 'gpt5-turbo-max' });
    expect(provider.isConfigured()).toBe(false);
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('sends the bearer token and asks for JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'gpt-4o-mini',
          choices: [{ message: { content: validAnalysis } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new OpenAiCompatibleProvider({
      name: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await provider.complete({
      system: 's',
      user: 'u',
      maxOutputTokens: 100,
      temperature: 0.1,
    });

    expect(response.usage.totalTokens).toBe(30);

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-test');
    expect(String(init.body)).toContain('json_object');
  });

  it('marks a 429 retryable and a 400 not', async () => {
    const make = (status: number): OpenAiCompatibleProvider =>
      new OpenAiCompatibleProvider({
        name: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'm',
        fetchImpl: vi.fn().mockResolvedValue(new Response('err', { status })) as unknown as typeof fetch,
      });

    await expect(
      make(429).complete({ system: '', user: '', maxOutputTokens: 1, temperature: 0 }),
    ).rejects.toMatchObject({ retryable: true });

    await expect(
      make(400).complete({ system: '', user: '', maxOutputTokens: 1, temperature: 0 }),
    ).rejects.toMatchObject({ retryable: false });
  });
});
