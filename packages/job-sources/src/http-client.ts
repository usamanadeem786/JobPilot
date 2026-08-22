import type { HttpRequestOptions, PolitelyRateLimitedHttp, SourceLogger } from './types';
import { SourceRequestError } from './types';

export interface HttpClientOptions {
  readonly userAgent: string;
  readonly requestsPerMinute: number;
  readonly maxRetries: number;
  readonly defaultTimeoutMs: number;
  readonly respectRobotsTxt: boolean;
  readonly logger: SourceLogger;
  /** Injected in tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * The one place outbound source traffic is shaped.
 *
 * Every adapter is handed this rather than calling fetch itself, so the rate
 * limit, backoff, identifying User-Agent and robots.txt check cannot be
 * skipped by a new source that forgets they exist. Politeness is a property of
 * the client, not a convention adapters are trusted to follow.
 */
export class PoliteHttpClient implements PolitelyRateLimitedHttp {
  private readonly minIntervalMs: number;
  private readonly robotsCache = new Map<string, Promise<RobotsRules>>();
  private nextSlotAt = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpClientOptions) {
    this.minIntervalMs = Math.ceil(60_000 / Math.max(1, options.requestsPerMinute));
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async getJson<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request(url, options);
    return (await response.json()) as T;
  }

  async getText(url: string, options: HttpRequestOptions = {}): Promise<string> {
    const response = await this.request(url, options);
    return response.text();
  }

  private async request(url: string, options: HttpRequestOptions): Promise<Response> {
    if (this.options.respectRobotsTxt && !options.skipRobots) {
      const allowed = await this.isAllowed(url);
      if (!allowed) {
        throw new SourceRequestError('http', `robots.txt disallows fetching ${url}`, 403);
      }
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      await this.waitForSlot();

      try {
        const response = await this.fetchOnce(url, options);

        // 429 and 5xx are worth retrying. A 404 or 403 is not, and retrying
        // only adds load to a source that has already said no.
        if (response.status === 429 || response.status >= 500) {
          lastError = new SourceRequestError(
            'http',
            `HTTP ${response.status} from ${url}`,
            response.status,
          );
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          if (attempt < this.options.maxRetries) {
            await sleep(retryAfter ?? backoffDelay(attempt));
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          throw new SourceRequestError(
            'http',
            `HTTP ${response.status} from ${url}`,
            response.status,
          );
        }

        return response;
      } catch (error) {
        const status = error instanceof SourceRequestError ? error.status : undefined;
        if (status !== undefined && status < 500 && status !== 429) throw error;

        lastError = error;
        if (attempt < this.options.maxRetries) await sleep(backoffDelay(attempt));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new SourceRequestError('http', `Request to ${url} failed.`);
  }

  private async fetchOnce(url: string, options: HttpRequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? this.options.defaultTimeoutMs,
    );

    try {
      return await this.fetchImpl(url, {
        headers: {
          // A real, identifying User-Agent with a contact address, so a site
          // owner who wants this traffic stopped has someone to reach.
          'User-Agent': this.options.userAgent,
          Accept: 'application/json, text/plain, */*',
          ...options.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Serialises requests so a source never sees a burst. */
  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.minIntervalMs;
    if (slot > now) await sleep(slot - now);
  }

  private async isAllowed(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    const origin = parsed.origin;
    let rules = this.robotsCache.get(origin);
    if (!rules) {
      rules = this.loadRobots(origin);
      this.robotsCache.set(origin, rules);
    }

    return isPathAllowed(await rules, parsed.pathname);
  }

  private async loadRobots(origin: string): Promise<RobotsRules> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const response = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { 'User-Agent': this.options.userAgent },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      // No robots.txt means no restriction has been expressed.
      if (!response.ok) return { disallow: [], allow: [] };
      return parseRobots(await response.text());
    } catch {
      // A robots.txt that cannot be read is treated as permissive rather than
      // blocking every source on one transient network error. The rate limit
      // still applies, so the failure mode stays polite either way.
      this.options.logger.debug('robots.txt unreadable, proceeding', { origin });
      return { disallow: [], allow: [] };
    }
  }
}

export interface RobotsRules {
  readonly disallow: string[];
  readonly allow: string[];
}

/**
 * Minimal robots.txt parser covering the directives that matter here: the
 * wildcard user-agent group's Allow and Disallow paths.
 */
export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = [];
  const allow: string[] = [];
  let inWildcardGroup = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      inWildcardGroup = value === '*';
      continue;
    }

    if (!inWildcardGroup) continue;
    if (field === 'disallow' && value) disallow.push(value);
    if (field === 'allow' && value) allow.push(value);
  }

  return { disallow, allow };
}

/** Longest matching rule wins, with Allow beating Disallow on a tie. */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  const longestMatch = (patterns: string[]): number =>
    patterns
      .filter((pattern) => path.startsWith(pattern))
      .reduce((best, pattern) => Math.max(best, pattern.length), -1);

  return longestMatch(rules.allow) >= longestMatch(rules.disallow);
}

/** Exponential backoff with jitter, so parallel retries do not synchronise. */
export function backoffDelay(attempt: number): number {
  const base = Math.min(1_000 * 2 ** attempt, 15_000);
  return base + Math.random() * 250;
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);

  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 30_000) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
