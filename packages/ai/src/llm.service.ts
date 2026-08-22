import type { z } from 'zod';
import {
  AiProviderNotConfiguredError,
  AiRequestError,
  AiResponseInvalidError,
  type LlmProvider,
  type StructuredRequest,
  type StructuredResponse,
} from './types';

export interface LlmServiceOptions {
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly onUsage?: (usage: UsageRecord) => void;
}

export interface UsageRecord {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly attempts: number;
  readonly durationMs: number;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;
const DEFAULT_TEMPERATURE = 0.2;

/**
 * Runs structured prompts against whichever provider is configured.
 *
 * Two rules are enforced here rather than left to callers:
 *
 *  1. Every response is validated against its Zod schema before it is
 *     returned. A malformed response is retried once with the parse errors fed
 *     back, then surfaced as AiResponseInvalidError — never written to the
 *     database half-parsed.
 *  2. Token usage is reported for every call, so cost is attributable to a
 *     specific prompt rather than appearing as one opaque monthly bill.
 */
export class LlmService {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly provider: LlmProvider,
    private readonly options: LlmServiceOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  get providerName(): string {
    return this.provider.name;
  }

  async complete<TSchema extends z.ZodTypeAny>(
    request: StructuredRequest<TSchema>,
  ): Promise<StructuredResponse<z.infer<TSchema>>> {
    if (!this.provider.isConfigured()) {
      throw new AiProviderNotConfiguredError(this.provider.name);
    }

    const startedAt = Date.now();
    let lastIssues: string[] = [];
    let lastRaw = '';

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      // On a retry after a schema failure, the model is told exactly what was
      // wrong. Repeating the identical prompt tends to produce the identical
      // malformed answer.
      const user =
        lastIssues.length > 0
          ? `${request.user}\n\nYour previous reply could not be parsed:\n${lastIssues
              .map((issue) => `- ${issue}`)
              .join('\n')}\nReply again with valid JSON only.`
          : request.user;

      const response = await this.callWithTimeout({
        system: request.system,
        user,
        maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        temperature: request.temperature ?? DEFAULT_TEMPERATURE,
      });

      lastRaw = response.text;
      const parsed = parseStructured(response.text, request.schema);

      if (parsed.ok) {
        this.options.onUsage?.({
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          model: response.model,
          ...response.usage,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        });

        return {
          data: parsed.value,
          usage: response.usage,
          model: response.model,
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          attempts: attempt,
        };
      }

      lastIssues = parsed.issues;
    }

    throw new AiResponseInvalidError(request.promptId, lastIssues, lastRaw.slice(0, 500));
  }

  private async callWithTimeout(
    request: Parameters<LlmProvider['complete']>[0],
  ): ReturnType<LlmProvider['complete']> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AiRequestError(`AI request timed out after ${this.timeoutMs}ms.`, true)),
        this.timeoutMs,
      );
    });

    try {
      return await Promise.race([this.provider.complete(request), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; issues: string[] };

/**
 * Extracts and validates JSON from a completion.
 *
 * Models wrap JSON in prose and fenced code blocks even when told not to, so
 * the payload is located before parsing. What is NOT done here is repairing
 * it: a response that needs guessing to become valid is a response that cannot
 * be trusted with someone's employment history.
 */
export function parseStructured<TSchema extends z.ZodTypeAny>(
  text: string,
  schema: TSchema,
): ParseOutcome<z.infer<TSchema>> {
  const candidate = extractJson(text);
  if (candidate === null) {
    return { ok: false, issues: ['No JSON object was found in the response.'] };
  }

  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (error) {
    return {
      ok: false,
      issues: [`The response was not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`],
    };
  }

  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };

  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    ),
  };
}

/**
 * Finds the JSON payload in a completion: a fenced block if present, otherwise
 * the outermost balanced braces. Brace counting is used rather than a regex
 * because nested objects defeat any non-recursive pattern.
 */
export function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const haystack = fenced?.[1]?.trim() ?? text;

  const start = haystack.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < haystack.length; index += 1) {
    const character = haystack[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return haystack.slice(start, index + 1);
    }
  }

  return null;
}
