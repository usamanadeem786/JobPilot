import { Global, Module, type Provider } from '@nestjs/common';
import {
  CvTailoringService,
  JobMatchingService,
  LlmService,
  analyseHeuristically,
  createProvider,
  type AnalyseJobInput,
} from '@jobpilot/ai';
import { ENV, type Env } from '../../config/config.module';

/** DI tokens. The AI package is plain TypeScript and knows nothing of Nest. */
export const LLM_SERVICE = Symbol('LLM_SERVICE');
export const JOB_MATCHING_SERVICE = Symbol('JOB_MATCHING_SERVICE');
export const CV_TAILORING_SERVICE = Symbol('CV_TAILORING_SERVICE');

/**
 * Wires the AI package into the application.
 *
 * The package is deliberately framework-free — it takes a provider and some
 * functions — so this module is the only place that knows how the two fit
 * together. Swapping OpenAI for Groq, or for the mock, is a change to
 * environment variables and nothing else.
 */
const providers: Provider[] = [
  {
    provide: LLM_SERVICE,
    inject: [ENV],
    useFactory: (env: Env): LlmService =>
      new LlmService(createProvider(env), {
        maxRetries: env.LLM_MAX_RETRIES,
        timeoutMs: env.LLM_TIMEOUT_MS,
        ...(env.LLM_DEFAULT_MODEL ? { defaultModel: env.LLM_DEFAULT_MODEL } : {}),
      }),
  },
  {
    provide: JOB_MATCHING_SERVICE,
    inject: [LLM_SERVICE],
    useFactory: (llm: LlmService): JobMatchingService =>
      // The heuristic is passed in rather than imported inside the matcher, so
      // a test can substitute a predictable one and the fallback path is
      // exercisable without a network.
      new JobMatchingService(llm, (input: AnalyseJobInput) => analyseHeuristically(input)),
  },
  {
    provide: CV_TAILORING_SERVICE,
    inject: [LLM_SERVICE],
    useFactory: (llm: LlmService): CvTailoringService => new CvTailoringService(llm),
  },
];

@Global()
@Module({ providers, exports: providers.map((provider) => (provider as { provide: symbol }).provide) })
export class AiModule {}
