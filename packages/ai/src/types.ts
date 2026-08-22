import type { z } from 'zod';

/**
 * The LLM abstraction.
 *
 * Every AI feature goes through this interface, so the provider is a
 * configuration choice rather than an architectural commitment. It also makes
 * the whole AI layer testable: `MockProvider` implements the same contract and
 * returns deterministic fixtures, so no test needs a key, a network call or a
 * budget.
 */

export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/**
 * A request for structured output.
 *
 * The schema is part of the request rather than something applied afterwards:
 * providers that support native structured output are given the JSON schema,
 * and the response is validated against the same Zod schema either way. That
 * closes the gap where a provider "supports JSON mode" but still returns a
 * shape the application did not ask for.
 */
export interface StructuredRequest<TSchema extends z.ZodTypeAny> {
  /** Prompt identifier, recorded on the result so old output is traceable. */
  readonly promptId: string;
  readonly promptVersion: string;
  readonly system: string;
  readonly user: string;
  readonly schema: TSchema;
  readonly maxOutputTokens?: number;
  /**
   * Low by default. These prompts extract and reorganise facts; creativity is
   * the failure mode, not the goal.
   */
  readonly temperature?: number;
}

export interface StructuredResponse<TOutput> {
  readonly data: TOutput;
  readonly usage: LlmUsage;
  readonly model: string;
  readonly promptId: string;
  readonly promptVersion: string;
  /** How many attempts the call took, including the successful one. */
  readonly attempts: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly defaultModel: string;

  isConfigured(): boolean;

  /**
   * Returns the raw completion text. Parsing and validation are the service's
   * job, so every provider fails the same way on malformed output.
   */
  complete(request: RawCompletionRequest): Promise<RawCompletionResponse>;

  embed?(inputs: readonly string[]): Promise<number[][]>;
}

export interface RawCompletionRequest {
  readonly system: string;
  readonly user: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  /** JSON schema for providers with native structured output support. */
  readonly jsonSchema?: Record<string, unknown>;
}

export interface RawCompletionResponse {
  readonly text: string;
  readonly usage: LlmUsage;
  readonly model: string;
}

export class AiProviderNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(`The ${providerName} provider is not configured. Add its API key to enable AI features.`);
    this.name = 'AiProviderNotConfiguredError';
  }
}

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

/**
 * The model returned something that did not match the schema.
 *
 * Deliberately distinct from a transport failure: nothing is saved, and the
 * user is told the output could not be verified rather than being shown
 * half-parsed content.
 */
export class AiResponseInvalidError extends Error {
  constructor(
    readonly promptId: string,
    readonly issues: string[],
    readonly rawExcerpt: string,
  ) {
    super(`The AI response for "${promptId}" did not match the expected shape.`);
    this.name = 'AiResponseInvalidError';
  }
}
