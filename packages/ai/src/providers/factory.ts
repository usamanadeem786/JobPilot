import { MockLlmProvider } from './mock';
import {
  OPENAI_COMPATIBLE_ENDPOINTS,
  OpenAiCompatibleProvider,
  type OpenAiCompatibleVendor,
} from './openai-compatible';
import type { LlmProvider } from '../types';

export interface ProviderEnv {
  readonly LLM_PROVIDER?: string;
  readonly LLM_DEFAULT_MODEL?: string;
  readonly OPENAI_API_KEY?: string;
  readonly OPENAI_BASE_URL?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly GROQ_API_KEY?: string;
  readonly GEMINI_API_KEY?: string;
  readonly OPENROUTER_API_KEY?: string;
}

/**
 * Sensible default models per vendor, chosen so a user who sets only an API
 * key gets something that works. Overridden by LLM_DEFAULT_MODEL.
 */
const DEFAULT_MODELS: Record<OpenAiCompatibleVendor, string> = {
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3.1',
};

const API_KEY_VARIABLE: Record<OpenAiCompatibleVendor, keyof ProviderEnv | null> = {
  openai: 'OPENAI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  ollama: null,
};

/**
 * Builds the configured provider.
 *
 * Defaults to the mock rather than throwing when nothing is configured: the
 * application should start and report "no AI provider configured" on the
 * screens that need one, not refuse to boot because an optional feature has no
 * key. Whether AI is genuinely available is `LlmService.isConfigured()`.
 */
export function createProvider(env: ProviderEnv, fetchImpl?: typeof fetch): LlmProvider {
  const requested = (env.LLM_PROVIDER ?? '').trim().toLowerCase();

  if (requested === 'mock' || requested === '') return new MockLlmProvider();

  if (isOpenAiCompatible(requested)) {
    const keyVariable = API_KEY_VARIABLE[requested];
    return new OpenAiCompatibleProvider({
      name: requested,
      apiKey: keyVariable ? env[keyVariable] : undefined,
      baseUrl:
        (requested === 'openai' ? env.OPENAI_BASE_URL : undefined) ??
        OPENAI_COMPATIBLE_ENDPOINTS[requested],
      defaultModel: env.LLM_DEFAULT_MODEL ?? DEFAULT_MODELS[requested],
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }

  // An unrecognised name is a typo in configuration. Falling back to the mock
  // silently would look like the AI working while returning fixtures, so the
  // provider reports itself as unconfigured instead.
  return new UnknownProvider(requested);
}

function isOpenAiCompatible(value: string): value is OpenAiCompatibleVendor {
  return value in OPENAI_COMPATIBLE_ENDPOINTS;
}

/** A named provider that does not exist. Never silently substitutes another. */
class UnknownProvider implements LlmProvider {
  readonly defaultModel = 'unknown';

  constructor(readonly name: string) {}

  isConfigured(): boolean {
    return false;
  }

  complete(): Promise<never> {
    return Promise.reject(
      new Error(
        `LLM_PROVIDER="${this.name}" is not a provider this build knows about. ` +
          `Supported: ${Object.keys(OPENAI_COMPATIBLE_ENDPOINTS).join(', ')}, mock.`,
      ),
    );
  }
}
