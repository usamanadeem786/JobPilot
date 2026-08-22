import { JobSourceKind } from '@jobpilot/shared';
import type {
  JobSourceAdapter,
  NormalisedJob,
  NormalisedQuery,
  SourceConfig,
  SourceContext,
  SourceHealth,
} from '../types';
import { SourceNotConfiguredError } from '../types';

/**
 * Platforms that require a signed partner agreement.
 *
 * LinkedIn, Indeed and Glassdoor all prohibit scraping and automated access in
 * their terms, and none offers an open jobs API. The honest implementation is
 * an adapter that stays switched off until a real agreement and a real token
 * exist — not a scraper, and not a silent omission that leaves a user
 * wondering why their LinkedIn results never appear.
 *
 * These deliberately contain no request code at all. There is nothing to
 * accidentally enable, and a future partner integration starts by replacing
 * `searchJobs` here rather than by removing a workaround.
 */

interface PartnerDefinition {
  readonly key: string;
  readonly displayName: string;
  readonly tokenVariable: string;
  readonly termsUrl: string;
}

export class PartnerApiAdapter implements JobSourceAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly kind = JobSourceKind.PARTNER_API;
  readonly termsUrl: string;
  private readonly tokenVariable: string;

  readonly capabilities = {
    supportsRemoteFilter: false,
    supportsSalaryFilter: false,
    supportsLocationFilter: false,
    providesPostingDate: false,
    providesFullDescription: false,
    supportsAutomatedApplication: false,
  };

  constructor(definition: PartnerDefinition) {
    this.key = definition.key;
    this.displayName = definition.displayName;
    this.termsUrl = definition.termsUrl;
    this.tokenVariable = definition.tokenVariable;
  }

  isConfigured(config: SourceConfig): boolean {
    return Boolean(config[this.tokenVariable]?.trim());
  }

  searchJobs(_query: NormalisedQuery, context: SourceContext): Promise<NormalisedJob[]> {
    if (!this.isConfigured(context.config)) {
      return Promise.reject(new SourceNotConfiguredError(this.key, [this.tokenVariable]));
    }

    // Reached only when a token is present, which means someone has signed an
    // agreement and must now implement against that specific partner API.
    return Promise.reject(
      new Error(
        `${this.displayName} has a token configured but no partner client is implemented. ` +
          'Implement the agreed API here before enabling this source.',
      ),
    );
  }

  healthCheck(context: SourceContext): Promise<SourceHealth> {
    const configured = this.isConfigured(context.config);

    return Promise.resolve({
      healthy: false,
      detail: configured
        ? 'Token present, partner client not implemented.'
        : `Not configured. Requires a partner agreement and ${this.tokenVariable}.`,
      checkedAt: new Date(),
    });
  }
}

export const LINKEDIN = new PartnerApiAdapter({
  key: 'linkedin',
  displayName: 'LinkedIn',
  tokenVariable: 'LINKEDIN_PARTNER_API_TOKEN',
  termsUrl: 'https://www.linkedin.com/legal/user-agreement',
});

export const INDEED = new PartnerApiAdapter({
  key: 'indeed',
  displayName: 'Indeed',
  tokenVariable: 'INDEED_PARTNER_API_TOKEN',
  termsUrl: 'https://www.indeed.com/legal',
});

export const GLASSDOOR = new PartnerApiAdapter({
  key: 'glassdoor',
  displayName: 'Glassdoor',
  tokenVariable: 'GLASSDOOR_PARTNER_API_TOKEN',
  termsUrl: 'https://www.glassdoor.com/about/terms.htm',
});
