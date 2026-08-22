import { validateNoFabrication, type CvDocument, type FabricationFinding } from '@jobpilot/cv';
import type { LlmService } from '../llm.service';
import { buildCvTailoringPrompt, type ChangeSummary } from '../prompts/cv-tailoring';
import { AiProviderNotConfiguredError } from '../types';

/**
 * CV tailoring.
 *
 * The prompt asks the model not to invent anything; this refuses to return the
 * result if it did anyway. That ordering is the whole design — a prompt is
 * guidance, and guidance is not a guarantee when the output is a document
 * someone sends to an employer with their name on it.
 *
 * A rejected generation fails loudly rather than saving a filtered version.
 * Silently stripping the invented parts would leave the user with a CV that
 * differs from what they were shown, which is its own problem.
 */

export interface TailoredCvResult {
  readonly document: CvDocument;
  readonly changeSummary: ChangeSummary;
  readonly promptVersion: string;
  readonly model: string;
  readonly generatedAt: string;
}

/**
 * Raised when the model returned content that is not in the source CV.
 *
 * Carries every finding, so the failure can be reported precisely rather than
 * as "generation failed" — and so a pattern of failures is diagnosable.
 */
export class CvFabricationError extends Error {
  constructor(readonly findings: readonly FabricationFinding[]) {
    super(
      `The generated CV contained ${findings.length} item(s) not present in your master CV, so it was discarded.`,
    );
    this.name = 'CvFabricationError';
  }
}

export interface TailorCvInput {
  readonly cv: CvDocument;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly jobDescription: string;
}

export interface TailoringOptions {
  readonly now?: () => Date;
  /**
   * Retries once when the first attempt fabricates. Models often comply after
   * being shown the specific violations, and a second call is cheaper than
   * making the user re-request.
   */
  readonly retryOnFabrication?: boolean;
  readonly logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

export class CvTailoringService {
  constructor(
    private readonly llm: LlmService,
    private readonly options: TailoringOptions = {},
  ) {}

  async tailor(input: TailorCvInput): Promise<TailoredCvResult> {
    if (!this.llm.isConfigured()) {
      // Unlike matching, there is no deterministic fallback here. Rewriting a
      // CV for a role needs judgement, and a keyword shuffle dressed up as
      // "tailoring" would be worse than telling the user it is unavailable.
      throw new AiProviderNotConfiguredError(this.llm.providerName);
    }

    const attempts = this.options.retryOnFabrication === false ? 1 : 2;
    let lastFindings: FabricationFinding[] = [];

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const prompt = buildCvTailoringPrompt(input);

      const request =
        lastFindings.length > 0
          ? {
              ...prompt,
              user: `${prompt.user}\n\nYour previous attempt added content that is NOT in the source CV:\n${lastFindings
                .map((finding) => `- ${finding.detail}`)
                .join('\n')}\nRemove those additions and try again. Every fact must come from the source CV.`,
            }
          : prompt;

      const response = await this.llm.complete(request);
      const validation = validateNoFabrication(input.cv, response.data.document);

      if (validation.ok) {
        return {
          document: response.data.document,
          changeSummary: response.data.changeSummary,
          promptVersion: response.promptVersion,
          model: response.model,
          generatedAt: (this.options.now?.() ?? new Date()).toISOString(),
        };
      }

      lastFindings = validation.findings;
      this.options.logger?.warn('Tailored CV rejected for fabrication', {
        job: input.jobTitle,
        attempt,
        findings: validation.findings.map((finding) => finding.detail),
      });
    }

    throw new CvFabricationError(lastFindings);
  }
}
