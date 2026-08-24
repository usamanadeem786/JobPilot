import { ApplyMethod, JobSourceKind } from '@jobpilot/shared';
import { cleanField, cleanOptional } from '../clean';
import {
  contentHash,
  htmlToText,
  parseSalaryFromText,
  toEmploymentType,
  toExperienceLevel,
  toPostedAt,
  toRemoteType,
} from '../normalise';
import type {
  JobSourceAdapter,
  NormalisedJob,
  NormalisedQuery,
  SourceConfig,
  SourceContext,
  SourceHealth,
} from '../types';
import { selectBestMatches } from '../relevance';

/**
 * Lever Postings.
 *
 * Lever publishes an unauthenticated postings API for the same syndication
 * purpose as Greenhouse, and like Greenhouse it is per-employer. Lever does
 * return a real `createdAt` timestamp, which makes it one of the few sources
 * that can legitimately contribute to the "Latest Jobs" view.
 */

interface LeverPosting {
  readonly id: string;
  readonly text: string;
  readonly createdAt?: number;
  readonly hostedUrl: string;
  readonly applyUrl?: string;
  readonly descriptionPlain?: string;
  readonly description?: string;
  readonly categories?: {
    readonly location?: string;
    readonly commitment?: string;
    readonly team?: string;
    readonly department?: string;
  };
  readonly workplaceType?: string;
}

const BASE_URL = 'https://api.lever.co/v0/postings';

export class LeverAdapter implements JobSourceAdapter {
  readonly key = 'lever';
  readonly displayName = 'Lever Postings';
  readonly kind = JobSourceKind.ATS_BOARD;
  readonly termsUrl = 'https://www.lever.co/legal/terms-of-service/';

  readonly capabilities = {
    supportsRemoteFilter: false,
    supportsSalaryFilter: false,
    supportsLocationFilter: false,
    providesPostingDate: true,
    providesFullDescription: true,
    supportsAutomatedApplication: false,
  };

  isConfigured(config: SourceConfig): boolean {
    return companySlugs(config).length > 0;
  }

  async searchJobs(query: NormalisedQuery, context: SourceContext): Promise<NormalisedJob[]> {
    const slugs = companySlugs(context.config);
    const results: NormalisedJob[] = [];

    // Fair share per company, for the same reason as Greenhouse.
    const perCompany = Math.max(1, Math.ceil(query.limit / Math.max(1, slugs.length)));

    for (const slug of slugs) {
      try {
        const postings = await context.http.getJson<readonly LeverPosting[]>(
          `${BASE_URL}/${encodeURIComponent(slug)}?mode=json`,
          { skipRobots: true },
        );

        // Ranked before truncating, for the same reason as Greenhouse.
        const normalised = postings.map((posting) => this.normalise(posting, slug));
        results.push(...selectBestMatches(normalised, query, perCompany));
      } catch (error) {
        context.logger.warn('Lever board unavailable', {
          company: slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  private normalise(posting: LeverPosting, slug: string): NormalisedJob {
    // Lever gives plain text directly when it has it, which is more faithful
    // than converting its HTML.
    const description = posting.descriptionPlain ?? htmlToText(posting.description ?? '');
    const title = cleanField(posting.text);
    const location = cleanOptional(posting.categories?.location);
    const companyName = companyFromSlug(slug);
    const postedAt = toPostedAt(posting.createdAt);
    const salary = parseSalaryFromText(description);

    return {
      sourceKey: this.key,
      externalJobId: posting.id,
      title,
      companyName,
      ...(location ? { location } : {}),
      remoteType: toRemoteType(`${posting.workplaceType ?? ''} ${location ?? ''} ${title}`),
      employmentType: toEmploymentType(posting.categories?.commitment),
      experienceLevel: toExperienceLevel(title),
      ...(salary ? { salary } : {}),
      description,
      jobUrl: posting.hostedUrl,
      applicationUrl: posting.applyUrl ?? posting.hostedUrl,
      applyMethod: ApplyMethod.EXTERNAL_URL,
      ...(postedAt ? { postedAt } : {}),
      postedAtKnown: postedAt !== undefined,
      contentHash: contentHash(title, companyName, location),
    };
  }

  async healthCheck(context: SourceContext): Promise<SourceHealth> {
    const [slug] = companySlugs(context.config);
    if (!slug) {
      return { healthy: false, detail: 'No company slugs configured.', checkedAt: new Date() };
    }

    try {
      await context.http.getJson<readonly LeverPosting[]>(
        `${BASE_URL}/${encodeURIComponent(slug)}?mode=json&limit=1`,
        { skipRobots: true, timeoutMs: 10_000 },
      );
      return { healthy: true, detail: `Board "${slug}" reachable.`, checkedAt: new Date() };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : 'Unreachable.',
        checkedAt: new Date(),
      };
    }
  }
}

function companySlugs(config: SourceConfig): string[] {
  return (config.LEVER_COMPANY_SLUGS ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function companyFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}
