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
import { selectBestMatches } from '../relevance';
import type {
  JobSourceAdapter,
  NormalisedJob,
  NormalisedQuery,
  SourceConfig,
  SourceContext,
  SourceHealth,
} from '../types';

/**
 * Greenhouse Job Boards.
 *
 * Greenhouse publishes a documented, unauthenticated JSON API so employers'
 * boards can be syndicated — exactly the use here. No credentials, no
 * scraping, and no terms problem: the endpoint exists to be read.
 *
 * The trade-off is that it is per-employer rather than a global search. The
 * configured board tokens decide which companies are searched, and the keyword
 * filter is applied locally because the API has no query parameter for it.
 */

interface GreenhouseJob {
  readonly id: number;
  readonly title: string;
  readonly updated_at?: string;
  readonly absolute_url: string;
  readonly location?: { readonly name?: string };
  readonly content?: string;
  readonly metadata?: readonly { readonly name?: string; readonly value?: unknown }[];
}

interface GreenhouseResponse {
  readonly jobs?: readonly GreenhouseJob[];
}

const BASE_URL = 'https://boards-api.greenhouse.io/v1/boards';

export class GreenhouseAdapter implements JobSourceAdapter {
  readonly key = 'greenhouse';
  readonly displayName = 'Greenhouse Job Boards';
  readonly kind = JobSourceKind.ATS_BOARD;
  readonly termsUrl = 'https://www.greenhouse.io/legal/terms-of-service';

  readonly capabilities = {
    supportsRemoteFilter: false,
    supportsSalaryFilter: false,
    supportsLocationFilter: false,
    providesPostingDate: true,
    providesFullDescription: true,
    supportsAutomatedApplication: false,
  };

  isConfigured(config: SourceConfig): boolean {
    return boardTokens(config).length > 0;
  }

  async searchJobs(query: NormalisedQuery, context: SourceContext): Promise<NormalisedJob[]> {
    const tokens = boardTokens(context.config);
    const results: NormalisedJob[] = [];

    // Each board gets an equal share of the limit. Taking them first-come
    // instead lets one large employer consume the entire budget, so every
    // other configured board silently returns nothing.
    const perBoard = Math.max(1, Math.ceil(query.limit / Math.max(1, tokens.length)));

    for (const token of tokens) {
      try {
        // `content=true` returns the full description in the list response,
        // which avoids a second request per job.
        const response = await context.http.getJson<GreenhouseResponse>(
          `${BASE_URL}/${encodeURIComponent(token)}/jobs?content=true`,
          { skipRobots: true },
        );

        // The whole board is normalised before anything is discarded. Cutting
        // at the limit while iterating keeps whatever the board listed first,
        // which is alphabetical - so a search for "engineer" filled up with
        // "Account Executive" and the engineering roles never made it in.
        const normalised = (response.jobs ?? []).map((job) => this.normalise(job, token));
        results.push(...selectBestMatches(normalised, query, perBoard));
      } catch (error) {
        // One employer's board being unavailable must not fail the search.
        // The source reports partial results and the caller records which
        // boards failed.
        context.logger.warn('Greenhouse board unavailable', {
          board: token,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  private normalise(job: GreenhouseJob, boardToken: string): NormalisedJob {
    const description = htmlToText(job.content ?? '');
    const title = cleanField(job.title);
    const location = cleanOptional(job.location?.name);
    const companyName = companyFromToken(boardToken);
    const postedAt = toPostedAt(job.updated_at);
    const salary = parseSalaryFromText(description);

    return {
      sourceKey: this.key,
      externalJobId: String(job.id),
      title,
      companyName,
      ...(location ? { location } : {}),
      remoteType: toRemoteType(`${location ?? ''} ${title}`),
      employmentType: toEmploymentType(metadataValue(job, 'employment type')),
      experienceLevel: toExperienceLevel(title),
      ...(salary ? { salary } : {}),
      description,
      jobUrl: job.absolute_url,
      applicationUrl: job.absolute_url,
      // Greenhouse has no permitted programmatic application path, so the
      // product always sends the user to the employer's own page.
      applyMethod: ApplyMethod.EXTERNAL_URL,
      ...(postedAt ? { postedAt } : {}),
      postedAtKnown: postedAt !== undefined,
      contentHash: contentHash(title, companyName, location),
    };
  }

  async healthCheck(context: SourceContext): Promise<SourceHealth> {
    const [token] = boardTokens(context.config);
    if (!token) {
      return { healthy: false, detail: 'No board tokens configured.', checkedAt: new Date() };
    }

    try {
      await context.http.getJson<GreenhouseResponse>(
        `${BASE_URL}/${encodeURIComponent(token)}/jobs`,
        { skipRobots: true, timeoutMs: 10_000 },
      );
      return { healthy: true, detail: `Board "${token}" reachable.`, checkedAt: new Date() };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : 'Unreachable.',
        checkedAt: new Date(),
      };
    }
  }
}

function boardTokens(config: SourceConfig): string[] {
  return (config.GREENHOUSE_BOARD_TOKENS ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * The board token is the company's Greenhouse slug ("stripe"), which is the
 * only company identifier the endpoint returns. Title-casing it is a display
 * convenience, not a claim about the registered company name.
 */
function companyFromToken(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function metadataValue(job: GreenhouseJob, name: string): string | undefined {
  const entry = job.metadata?.find((item) => item.name?.toLowerCase() === name);
  return typeof entry?.value === 'string' ? entry.value : undefined;
}

/**
 * Local filtering, because the board API offers no query parameters. Keywords
 * are matched against the title and description; every term must appear.
 */
/**
 * Re-exported so existing importers and tests keep working. The logic now
 * lives in `../relevance`, shared with every other adapter that has to filter
 * a whole board locally.
 */
export { matchesQuery } from '../relevance';
