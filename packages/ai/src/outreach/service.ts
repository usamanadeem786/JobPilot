import type { CvDocument } from '@jobpilot/cv';
import type { LlmService } from '../llm.service';
import { buildOutreachPrompt, type OutreachResult } from '../prompts/outreach';
import { AiProviderNotConfiguredError } from '../types';

/**
 * Drafts an introduction to a hiring contact.
 *
 * There is deliberately no deterministic fallback. Matching may fall back to
 * a keyword count because a rough score is still useful; a message that goes
 * out over someone's own name cannot be assembled from a template and passed
 * off as theirs. Without a provider this reports itself unavailable.
 */

export interface DraftOutreachInput {
  readonly cv: CvDocument;
  readonly jobTitle: string;
  readonly companyName: string;
  readonly jobDescription: string;
  readonly contactName: string | null;
  readonly tone: 'professional' | 'warm' | 'brief';
}

export interface DraftedOutreach extends OutreachResult {
  readonly model: string;
  readonly promptVersion: string;
  readonly generatedAt: string;
}

export interface OutreachOptions {
  /** Injected so tests do not depend on the real clock. */
  readonly now?: () => Date;
}

export class OutreachDraftingService {
  constructor(
    private readonly llm: LlmService,
    private readonly options: OutreachOptions = {},
  ) {}

  async draft(input: DraftOutreachInput): Promise<DraftedOutreach> {
    if (!this.llm.isConfigured()) throw new AiProviderNotConfiguredError('outreach');

    const prompt = buildOutreachPrompt(input);
    const response = await this.llm.complete(prompt);

    const now = (this.options.now ?? (() => new Date()))();

    return {
      ...response.data,
      model: response.model,
      promptVersion: prompt.promptVersion,
      generatedAt: now.toISOString(),
    };
  }
}
