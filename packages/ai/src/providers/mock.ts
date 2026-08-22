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

  private readonly responses: string[];
  private index = 0;
  readonly requests: RawCompletionRequest[] = [];

  /**
   * @param responses Returned in order; the last one repeats once exhausted,
   *   so a test that makes an unexpected extra call gets a valid answer rather
   *   than an unrelated crash.
   */
  constructor(responses: readonly string[] = ['{}']) {
    this.responses = responses.length > 0 ? [...responses] : ['{}'];
  }

  isConfigured(): boolean {
    return true;
  }

  complete(request: RawCompletionRequest): Promise<RawCompletionResponse> {
    this.requests.push(request);

    const text = this.responses[Math.min(this.index, this.responses.length - 1)] ?? '{}';
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
