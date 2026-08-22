import type { CvDocument } from '@jobpilot/cv';
import type { LlmService } from '../llm.service';
import { buildJobAnalysisPrompt, type JobAnalysisResult } from '../prompts/job-analysis';
import { AiProviderNotConfiguredError, AiResponseInvalidError } from '../types';

/**
 * Produces a match analysis for one job.
 *
 * Two paths, and which one ran is always recorded. A score is an estimate
 * either way, but a keyword count and a language model's reading are estimates
 * of different quality, and the UI has to be able to say which it is showing.
 */

export type AnalysisMethod = 'llm' | 'heuristic';

export interface JobAnalysis extends JobAnalysisResult {
  /** How the score was produced. Surfaced in the UI, never hidden. */
  readonly method: AnalysisMethod;
  readonly promptVersion: string | null;
  readonly model: string | null;
  /**
   * Set when the LLM was configured but the call failed and the heuristic ran
   * instead, so a degraded result is visibly degraded.
   */
  readonly fellBackBecause: string | null;
  readonly analysedAt: string;
}

export interface AnalyseJobInput {
  readonly cv: CvDocument;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly jobDescription: string;
  readonly jobLocation?: string;
  readonly remoteType?: string;
  readonly experienceLevel?: string;
}

export interface JobMatchingOptions {
  /** Injected so tests do not depend on the real clock. */
  readonly now?: () => Date;
  readonly logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

export class JobMatchingService {
  constructor(
    private readonly llm: LlmService,
    private readonly heuristic: (input: AnalyseJobInput) => JobAnalysisResult,
    private readonly options: JobMatchingOptions = {},
  ) {}

  /**
   * Uses the LLM when one is configured, and falls back to the deterministic
   * matcher when it is not — or when the call fails.
   *
   * Falling back rather than erroring is deliberate: a search that returns 200
   * jobs and no scores because a provider had a bad minute is worse than 200
   * jobs with clearly-labelled keyword scores.
   */
  async analyse(input: AnalyseJobInput): Promise<JobAnalysis> {
    const analysedAt = (this.options.now?.() ?? new Date()).toISOString();

    if (!this.llm.isConfigured()) {
      return { ...this.heuristic(input), method: 'heuristic', promptVersion: null, model: null, fellBackBecause: null, analysedAt };
    }

    try {
      const response = await this.llm.complete(buildJobAnalysisPrompt(input));
      return {
        ...response.data,
        method: 'llm',
        promptVersion: response.promptVersion,
        model: response.model,
        fellBackBecause: null,
        analysedAt,
      };
    } catch (error) {
      const reason = describeFailure(error);
      this.options.logger?.warn('Job analysis fell back to the heuristic matcher', {
        job: input.jobTitle,
        reason,
      });

      return {
        ...this.heuristic(input),
        method: 'heuristic',
        promptVersion: null,
        model: null,
        fellBackBecause: reason,
        analysedAt,
      };
    }
  }

  /**
   * Analyses many jobs with bounded concurrency.
   *
   * Firing 200 requests at once is how a provider rate-limits an account, so
   * the queue is drained by a fixed number of workers instead. Order is
   * preserved so results line up with the input.
   */
  async analyseMany(
    inputs: readonly AnalyseJobInput[],
    concurrency = 4,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<JobAnalysis[]> {
    const results = new Array<JobAnalysis>(inputs.length);
    let nextIndex = 0;
    let completed = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= inputs.length) return;

        const input = inputs[index];
        if (!input) return;

        results[index] = await this.analyse(input);
        completed += 1;
        onProgress?.(completed, inputs.length);
      }
    };

    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(concurrency, inputs.length)) }, worker),
    );

    return results;
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof AiProviderNotConfiguredError) return 'No AI provider is configured.';
  if (error instanceof AiResponseInvalidError) return 'The AI response could not be verified.';
  if (error instanceof Error) return error.message;
  return 'Unknown error.';
}
