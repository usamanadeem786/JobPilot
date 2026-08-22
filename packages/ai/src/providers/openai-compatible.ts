import { AiRequestError, type LlmProvider, type RawCompletionRequest, type RawCompletionResponse } from '../types';

/**
 * One client for every provider that speaks the OpenAI chat-completions
 * dialect.
 *
 * OpenAI, Groq, Together, OpenRouter, Ollama and Google's OpenAI-compatible
 * endpoint all accept the same request shape. Writing one adapter with a
 * configurable base URL covers all of them, and means a user can switch to a
 * free provider by changing two environment variables rather than waiting for
 * a new integration.
 */

export interface OpenAiCompatibleOptions {
  readonly name: string;
  readonly apiKey: string | undefined;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  readonly model?: string;
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
  readonly error?: { readonly message?: string };
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.name = options.name;
    this.defaultModel = options.defaultModel;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    // A local Ollama needs no key, so an explicitly local base URL counts as
    // configured on its own.
    if (isLocalEndpoint(this.options.baseUrl)) return true;
    return Boolean(this.options.apiKey?.trim());
  }

  async complete(request: RawCompletionRequest): Promise<RawCompletionResponse> {
    const response = await this.fetchImpl(`${trimSlash(this.options.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.options.defaultModel,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        // Ask for JSON natively where supported. The service validates the
        // result regardless, so a provider that ignores this is still safe.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await safeErrorText(response);
      // 429 and 5xx are transient; a 400 or 401 will fail identically forever.
      throw new AiRequestError(
        `${this.name} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status === 429 || response.status >= 500,
      );
    }

    const body = (await response.json()) as ChatCompletionResponse;
    if (body.error?.message) throw new AiRequestError(body.error.message, false);

    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new AiRequestError(`${this.name} returned an empty completion.`, true);
    }

    return {
      text,
      model: body.model ?? this.options.defaultModel,
      usage: {
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
        totalTokens: body.usage?.total_tokens ?? 0,
      },
    };
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isLocalEndpoint(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url);
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

/** Base URLs for the providers this dialect covers, including free options. */
export const OPENAI_COMPATIBLE_ENDPOINTS = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ollama: 'http://localhost:11434/v1',
} as const;

export type OpenAiCompatibleVendor = keyof typeof OPENAI_COMPATIBLE_ENDPOINTS;
