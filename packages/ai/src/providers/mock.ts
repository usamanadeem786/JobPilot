import type { LlmProvider, RawCompletionRequest, RawCompletionResponse } from '../types';

/**
 * A deterministic provider for tests and for running the app without a key.
 *
 * Every AI-dependent path — job analysis, CV tailoring, outreach drafting —
 * can be exercised end to end with no network, no cost and no variability.
 * Without this, the only way to test the AI layer would be to mock at the
 * call site in each test, which tests the mock rather than the code.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-1';

  private readonly responses: string[] | null;
  private readonly responder: ((request: RawCompletionRequest) => string) | null;
  private index = 0;
  readonly requests: RawCompletionRequest[] = [];

  /**
   * @param responses Either canned answers returned in order — the last one
   *   repeats once exhausted, so an unexpected extra call gets a valid answer
   *   rather than an unrelated crash — or a function that answers each
   *   request.
   *
   *   Passing nothing gives the built-in responder, which returns a
   *   schema-valid answer for each known prompt. That matters beyond tests:
   *   `LLM_PROVIDER=mock` is the documented way to run the whole product with
   *   no API key, and a provider that replies `{}` to everything fails
   *   validation on every call, so every AI feature silently degrades to its
   *   fallback and the AI path is never actually exercised.
   */
  constructor(responses: readonly string[] | ((request: RawCompletionRequest) => string) = defaultResponder) {
    if (typeof responses === 'function') {
      this.responder = responses;
      this.responses = null;
      return;
    }

    this.responder = null;
    this.responses = responses.length > 0 ? [...responses] : ['{}'];
  }

  isConfigured(): boolean {
    return true;
  }

  complete(request: RawCompletionRequest): Promise<RawCompletionResponse> {
    this.requests.push(request);

    const text = this.responder
      ? this.responder(request)
      : (this.responses?.[Math.min(this.index, this.responses.length - 1)] ?? '{}');
    this.index += 1;

    // Roughly four characters per token. Good enough to assert that accounting
    // is wired up, and never presented as a real count.
    const promptTokens = Math.ceil((request.system.length + request.user.length) / 4);
    const completionTokens = Math.ceil(text.length / 4);

    return Promise.resolve({
      text,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      model: this.defaultModel,
    });
  }

  embed(inputs: readonly string[]): Promise<number[][]> {
    // Deterministic pseudo-embeddings: stable for the same input, different
    // for different inputs, which is all a similarity test needs.
    return Promise.resolve(
      inputs.map((input) => {
        const vector = new Array<number>(8).fill(0);
        for (let index = 0; index < input.length; index += 1) {
          vector[index % 8] = (vector[index % 8] ?? 0) + input.charCodeAt(index);
        }
        const magnitude = Math.hypot(...vector) || 1;
        return vector.map((value) => value / magnitude);
      }),
    );
  }
}

/**
 * The built-in answer for each known prompt.
 *
 * Deliberately derived from the request rather than a fixed blob: a constant
 * would give every job the same score and every tailored CV the same summary,
 * which looks convincing in a demo and hides bugs in everything downstream
 * that consumes the values.
 *
 * These are clearly synthetic and always reported as coming from the "mock"
 * provider. Nothing here should ever be mistaken for a real model's judgement
 * — but it must be *shaped* like one, so the code paths that read it are
 * genuinely exercised.
 */
export function defaultResponder(request: RawCompletionRequest): string {
  const prompt = `${request.system}\n${request.user}`;

  if (/tailor/i.test(request.system)) return tailoringAnswer(prompt);
  if (/assess how well/i.test(request.system)) return analysisAnswer(prompt);
  if (/short introduction/i.test(request.system)) return outreachAnswer(prompt);

  return '{}';
}

/**
 * A placeholder introduction that makes no claims.
 *
 * The same reasoning as the tailoring stand-in: this text could be sent to a
 * real hiring contact over the user's name, so it must not assert anything
 * about them. It states plainly that it is a placeholder, which is both true
 * and impossible to send by accident without noticing.
 */
function outreachAnswer(prompt: string): string {
  const title = /Title:\s*(.+)/.exec(prompt)?.[1]?.trim() ?? 'the role';
  const company = /Company:\s*(.+)/.exec(prompt)?.[1]?.trim() ?? 'your company';

  return JSON.stringify({
    subject: `Regarding the ${title} role`,
    body:
      'This is a placeholder written by the built-in mock provider, not by a ' +
      `language model. It is addressed to ${company} about the ${title} role. ` +
      'Configure a real AI provider to have an actual introduction drafted, or ' +
      'replace this text yourself before approving it.',
    claimsMade: [],
  });
}

/** A stable pseudo-random number in [0, 1) for a string. */
function hashUnit(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

/** Words in the prompt that look like technologies, for plausible skill lists. */
function candidateSkills(prompt: string): string[] {
  const known = [
    'typescript', 'javascript', 'python', 'go', 'java', 'ruby', 'rust', 'sql',
    'react', 'next.js', 'node', 'django', 'rails', 'graphql', 'rest',
    'postgres', 'postgresql', 'mysql', 'redis', 'kafka', 'docker',
    'kubernetes', 'aws', 'gcp', 'azure', 'terraform', 'ci/cd',
  ];

  const lower = prompt.toLowerCase();
  return known.filter((skill) => lower.includes(skill)).slice(0, 12);
}

function analysisAnswer(prompt: string): string {
  const skills = candidateSkills(prompt);
  const split = Math.ceil(skills.length / 2);
  const matching = skills.slice(0, split);
  const missing = skills.slice(split);

  // Scored from the overlap so different jobs get different, explicable
  // numbers rather than one constant.
  const overlap = skills.length === 0 ? 0.5 : matching.length / skills.length;
  const score = Math.round(35 + overlap * 45 + hashUnit(prompt) * 15);

  const recommendation =
    score >= 75 ? 'STRONG_MATCH' : score >= 55 ? 'POSSIBLE_MATCH' : 'WEAK_MATCH';

  return JSON.stringify({
    score: Math.min(100, Math.max(0, score)),
    matchingSkills: matching,
    missingSkills: missing,
    matchingExperience: [],
    missingExperience: [],
    recommendation,
    reason:
      'Generated by the built-in mock provider, not a language model. ' +
      `It matched ${matching.length} of ${skills.length} technologies named in the posting. ` +
      'Configure a real provider for an actual assessment.',
  });
}

/**
 * Tailoring returns the CV unchanged.
 *
 * The one thing a stand-in for this must not do is invent content: the whole
 * anti-fabrication guarantee is that a tailored CV contains no fact absent
 * from the original. Echoing the source document back satisfies the schema,
 * passes the fabrication check honestly, and reports that nothing was
 * rewritten — rather than manufacturing achievements a user might send to an
 * employer.
 */
/**
 * Finds the source CV embedded in a prompt.
 *
 * Brace-matched rather than regex-matched. A greedy `{...}` runs from the
 * first brace to the last one in the whole prompt, which here swallows the
 * CV, the job description and the example response shape printed at the end -
 * producing text that is not valid JSON at all.
 */
function firstCvObject(prompt: string): unknown {
  for (let start = prompt.indexOf('{'); start !== -1; start = prompt.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < prompt.length; index += 1) {
      const character = prompt[index];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;

      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(prompt.slice(start, index + 1));
          if (parsed && typeof parsed === 'object' && 'personal' in parsed) return parsed;
        } catch {
          // Not the object we are after; keep looking from the next brace.
        }
        break;
      }
    }
  }

  return null;
}

function tailoringAnswer(prompt: string): string {
  const document = firstCvObject(prompt);

  return JSON.stringify({
    document,
    changeSummary: {
      keywordsEmphasised: [],
      experienceEmphasised: [],
      skillsMatched: candidateSkills(prompt).slice(0, 6),
      requirementsNotEvidenced: [],
      sectionsReordered: false,
      notes:
        'The built-in mock provider returns your CV unchanged. Configure a real ' +
        'AI provider to have it tailored to this job.',
    },
  });
}
