import { GreenhouseAdapter } from './adapters/greenhouse';
import { LeverAdapter } from './adapters/lever';
import { GLASSDOOR, INDEED, LINKEDIN } from './adapters/partner';
import { deduplicateJobs, type DedupeResult } from './dedupe';
import { PoliteHttpClient } from './http-client';
import type {
  JobSourceAdapter,
  NormalisedJob,
  NormalisedQuery,
  SourceConfig,
  SourceContext,
  SourceLogger,
} from './types';
import { SourceNotConfiguredError } from './types';

/**
 * The adapter registry.
 *
 * Adding a source is one entry here plus its file. No service, controller or
 * UI component enumerates sources by name, which is what keeps the application
 * from being welded to any single platform.
 */
export function createDefaultAdapters(): JobSourceAdapter[] {
  return [
    new GreenhouseAdapter(),
    new LeverAdapter(),
    // Disabled until a partner agreement exists. Present so the UI can show
    // them as unavailable-and-why rather than pretending they do not exist.
    LINKEDIN,
    INDEED,
    GLASSDOOR,
  ];
}

export interface SearchOptions {
  readonly query: NormalisedQuery;
  readonly config: SourceConfig;
  readonly logger: SourceLogger;
  /** Restricts the search to these source keys; omit for all configured. */
  readonly onlySources?: readonly string[];
  readonly userAgent: string;
  readonly requestsPerMinute?: number;
  readonly respectRobotsTxt?: boolean;
  readonly onProgress?: (event: SearchProgressEvent) => void;
}

export type SearchProgressEvent =
  | { readonly type: 'source-started'; readonly sourceKey: string }
  | { readonly type: 'source-completed'; readonly sourceKey: string; readonly found: number }
  | { readonly type: 'source-failed'; readonly sourceKey: string; readonly reason: string }
  | { readonly type: 'source-skipped'; readonly sourceKey: string; readonly reason: string }
  | { readonly type: 'deduplicating'; readonly total: number }
  | { readonly type: 'completed'; readonly unique: number; readonly removed: number };

export interface SearchOutcome {
  readonly jobs: NormalisedJob[];
  readonly dedupe: DedupeResult;
  readonly sourcesSearched: string[];
  readonly sourcesFailed: { readonly sourceKey: string; readonly reason: string }[];
  readonly sourcesSkipped: { readonly sourceKey: string; readonly reason: string }[];
}

/**
 * Runs a search across every configured source.
 *
 * A source that fails does not fail the search: the outcome records which ones
 * were skipped and which errored, so the UI can say "Greenhouse returned 12
 * jobs, LinkedIn is not configured" instead of showing one opaque error.
 */
export async function searchAllSources(
  adapters: readonly JobSourceAdapter[],
  options: SearchOptions,
): Promise<SearchOutcome> {
  const http = new PoliteHttpClient({
    userAgent: options.userAgent,
    requestsPerMinute: options.requestsPerMinute ?? 30,
    maxRetries: 2,
    defaultTimeoutMs: 20_000,
    respectRobotsTxt: options.respectRobotsTxt ?? true,
    logger: options.logger,
  });

  const context: SourceContext = { http, config: options.config, logger: options.logger };

  const selected = options.onlySources
    ? adapters.filter((adapter) => options.onlySources?.includes(adapter.key))
    : adapters;

  const collected: NormalisedJob[] = [];
  const sourcesSearched: string[] = [];
  const sourcesFailed: { sourceKey: string; reason: string }[] = [];
  const sourcesSkipped: { sourceKey: string; reason: string }[] = [];

  for (const adapter of selected) {
    if (!adapter.isConfigured(options.config)) {
      const reason = `${adapter.displayName} is not configured.`;
      sourcesSkipped.push({ sourceKey: adapter.key, reason });
      options.onProgress?.({ type: 'source-skipped', sourceKey: adapter.key, reason });
      continue;
    }

    options.onProgress?.({ type: 'source-started', sourceKey: adapter.key });

    try {
      const jobs = await adapter.searchJobs(options.query, context);
      collected.push(...jobs);
      sourcesSearched.push(adapter.key);
      options.onProgress?.({
        type: 'source-completed',
        sourceKey: adapter.key,
        found: jobs.length,
      });
    } catch (error) {
      const reason =
        error instanceof SourceNotConfiguredError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Unknown error.';
      sourcesFailed.push({ sourceKey: adapter.key, reason });
      options.onProgress?.({ type: 'source-failed', sourceKey: adapter.key, reason });
    }
  }

  options.onProgress?.({ type: 'deduplicating', total: collected.length });
  const dedupe = deduplicateJobs(collected);
  options.onProgress?.({
    type: 'completed',
    unique: dedupe.unique.length,
    removed: dedupe.duplicatesRemoved,
  });

  return { jobs: dedupe.unique, dedupe, sourcesSearched, sourcesFailed, sourcesSkipped };
}

/** Reads source configuration out of the process environment. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SourceConfig {
  const keys = [
    'GREENHOUSE_BOARD_TOKENS',
    'LEVER_COMPANY_SLUGS',
    'ASHBY_JOB_BOARD_NAMES',
    'ADZUNA_APP_ID',
    'ADZUNA_APP_KEY',
    'ADZUNA_COUNTRY',
    'JOOBLE_API_KEY',
    'LINKEDIN_PARTNER_API_TOKEN',
    'INDEED_PARTNER_API_TOKEN',
    'GLASSDOOR_PARTNER_API_TOKEN',
  ] as const;

  return Object.fromEntries(keys.map((key) => [key, env[key]])) as SourceConfig;
}
