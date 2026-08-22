import type {
  ApplyMethod,
  EmploymentType,
  ExperienceLevel,
  JobSourceKind,
  RemoteType,
  SalaryPeriod,
} from '@jobpilot/shared';

/**
 * What a source can actually do.
 *
 * Declared rather than assumed, because the search pipeline has to behave
 * differently per source: one that cannot filter by location server-side needs
 * the filter applied locally, and one that does not publish posting dates must
 * never contribute to the "Latest Jobs" ranking.
 */
export interface SourceCapabilities {
  readonly supportsRemoteFilter: boolean;
  readonly supportsSalaryFilter: boolean;
  readonly supportsLocationFilter: boolean;
  /** Drives `Job.postedAtKnown`. False means dates are discovery time only. */
  readonly providesPostingDate: boolean;
  readonly providesFullDescription: boolean;
  /**
   * False for every source shipped at launch. Automated submission is only
   * ever enabled where a platform's terms explicitly permit it.
   */
  readonly supportsAutomatedApplication: boolean;
}

/** A normalised search request, independent of any source's query dialect. */
export interface NormalisedQuery {
  readonly keywords: string;
  readonly location?: string;
  readonly remoteOnly?: boolean;
  readonly minSalary?: number;
  readonly experienceLevel?: ExperienceLevel;
  readonly employmentType?: EmploymentType;
  readonly limit: number;
}

export interface NormalisedSalary {
  readonly min?: number;
  readonly max?: number;
  readonly currency?: string;
  readonly period: SalaryPeriod;
}

/**
 * A job in the shape the database stores, after the source's own format has
 * been mapped away. Adapters return this; nothing downstream knows which
 * source it came from beyond the `sourceKey` field.
 */
export interface NormalisedJob {
  readonly sourceKey: string;
  readonly externalJobId: string;
  readonly title: string;
  readonly companyName: string;
  readonly companyWebsite?: string;
  readonly companyLogo?: string;
  readonly location?: string;
  readonly remoteType: RemoteType;
  readonly employmentType: EmploymentType;
  readonly experienceLevel: ExperienceLevel;
  readonly salary?: NormalisedSalary;
  readonly description: string;
  readonly jobUrl: string;
  readonly applicationUrl: string;
  readonly applyMethod: ApplyMethod;
  /** Only set when the source actually published one. Never inferred. */
  readonly postedAt?: Date;
  readonly postedAtKnown: boolean;
  /** Stable hash of the posting's content, used for cross-source dedupe. */
  readonly contentHash: string;
}

export interface SourceHealth {
  readonly healthy: boolean;
  readonly detail: string;
  readonly checkedAt: Date;
}

/** Per-source configuration resolved from the environment. */
export interface SourceConfig {
  readonly [key: string]: string | undefined;
}

/**
 * Services an adapter is given rather than creating for itself.
 *
 * The HTTP client is the important one: it carries the rate limit, backoff,
 * User-Agent and robots.txt policy. An adapter that opened its own socket
 * would bypass all of it, so none of them are allowed to.
 */
export interface SourceContext {
  readonly http: PolitelyRateLimitedHttp;
  readonly config: SourceConfig;
  readonly logger: SourceLogger;
}

export interface SourceLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface HttpRequestOptions {
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  /** Skip the robots.txt check for documented APIs that publish no robots. */
  readonly skipRobots?: boolean;
}

export interface PolitelyRateLimitedHttp {
  getJson<T>(url: string, options?: HttpRequestOptions): Promise<T>;
  getText(url: string, options?: HttpRequestOptions): Promise<string>;
}

/**
 * The contract every job source implements.
 *
 * Adding a source is a new file plus one registry entry; nothing else in the
 * application changes. That is the whole point of the interface — the brief
 * asked not to be locked to any one platform.
 */
export interface JobSourceAdapter {
  readonly key: string;
  readonly displayName: string;
  readonly kind: JobSourceKind;
  readonly termsUrl: string;
  readonly capabilities: SourceCapabilities;

  /**
   * False when required credentials are absent. The API then reports
   * SOURCE_NOT_CONFIGURED for this source instead of failing the whole search.
   */
  isConfigured(config: SourceConfig): boolean;

  searchJobs(query: NormalisedQuery, context: SourceContext): Promise<NormalisedJob[]>;
  getJobDetails?(externalJobId: string, context: SourceContext): Promise<NormalisedJob | null>;
  healthCheck(context: SourceContext): Promise<SourceHealth>;
}

/** Raised when a source is asked to run without its credentials. */
export class SourceNotConfiguredError extends Error {
  constructor(
    readonly sourceKey: string,
    readonly missing: string[],
  ) {
    super(`${sourceKey} is not configured. Missing: ${missing.join(', ')}.`);
    this.name = 'SourceNotConfiguredError';
  }
}

/** Raised when a source is reachable but refused or failed the request. */
export class SourceRequestError extends Error {
  constructor(
    readonly sourceKey: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceRequestError';
  }
}
