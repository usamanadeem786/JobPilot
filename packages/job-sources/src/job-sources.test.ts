import { ApplyMethod, EmploymentType, ExperienceLevel, RemoteType, SalaryPeriod } from '@jobpilot/shared';
import { describe, expect, it, vi } from 'vitest';
import { GreenhouseAdapter } from './adapters/greenhouse';
import { GLASSDOOR, INDEED, LINKEDIN } from './adapters/partner';
import { deduplicateJobs, titleSimilarity } from './dedupe';
import { isPathAllowed, parseRetryAfter, parseRobots, PoliteHttpClient } from './http-client';
import {
  contentHash,
  htmlToText,
  parseSalaryFromText,
  toEmploymentType,
  toExperienceLevel,
  toPostedAt,
  toRemoteType,
} from './normalise';
import { createDefaultAdapters, searchAllSources } from './registry';
import { SourceNotConfiguredError, type NormalisedJob, type SourceLogger } from './types';

const silentLogger: SourceLogger = { debug: () => {}, warn: () => {}, error: () => {} };

function job(overrides: Partial<NormalisedJob> = {}): NormalisedJob {
  const title = overrides.title ?? 'Python Backend Developer';
  const companyName = overrides.companyName ?? 'Acme';
  return {
    sourceKey: 'greenhouse',
    externalJobId: '1',
    title,
    companyName,
    remoteType: RemoteType.UNKNOWN,
    employmentType: EmploymentType.UNKNOWN,
    experienceLevel: ExperienceLevel.UNKNOWN,
    description: 'Build APIs.',
    jobUrl: 'https://example.com/1',
    applicationUrl: 'https://example.com/1',
    applyMethod: ApplyMethod.EXTERNAL_URL,
    postedAtKnown: false,
    contentHash: contentHash(title, companyName, overrides.location),
    ...overrides,
  };
}

describe('normalisation', () => {
  it('never guesses a remote type the source did not state', () => {
    expect(toRemoteType(undefined)).toBe(RemoteType.UNKNOWN);
    expect(toRemoteType('London')).toBe(RemoteType.UNKNOWN);
  });

  it('reads remote, hybrid and onsite when stated', () => {
    expect(toRemoteType('Remote - US')).toBe(RemoteType.REMOTE);
    expect(toRemoteType('Hybrid (2 days in office)')).toBe(RemoteType.HYBRID);
    expect(toRemoteType('On-site, Berlin')).toBe(RemoteType.ONSITE);
  });

  it('prefers hybrid over remote when both words appear', () => {
    // "Hybrid remote" is hybrid; matching remote first would mislabel it.
    expect(toRemoteType('Hybrid remote')).toBe(RemoteType.HYBRID);
  });

  it('maps employment types across the spellings boards use', () => {
    expect(toEmploymentType('Full-time')).toBe(EmploymentType.FULL_TIME);
    expect(toEmploymentType('FULL_TIME')).toBe(EmploymentType.FULL_TIME);
    expect(toEmploymentType('Contractor')).toBe(EmploymentType.CONTRACT);
    expect(toEmploymentType(null)).toBe(EmploymentType.UNKNOWN);
  });

  it('derives seniority from the title only', () => {
    expect(toExperienceLevel('Senior Python Developer')).toBe(ExperienceLevel.SENIOR);
    expect(toExperienceLevel('Staff Engineer')).toBe(ExperienceLevel.LEAD);
    expect(toExperienceLevel('Head of Engineering')).toBe(ExperienceLevel.EXECUTIVE);
    expect(toExperienceLevel('Graduate Developer')).toBe(ExperienceLevel.JUNIOR);
    expect(toExperienceLevel('Python Developer')).toBe(ExperienceLevel.UNKNOWN);
  });

  it('converts description HTML to readable text with bullets intact', () => {
    const text = htmlToText('<p>We need:</p><ul><li>Python</li><li>Django</li></ul>');
    expect(text).toContain('We need:');
    expect(text).toContain('• Python');
    expect(text).toContain('• Django');
    expect(text).not.toContain('<');
  });

  it('decodes entities and drops scripts', () => {
    expect(htmlToText('<script>alert(1)</script><p>R&amp;D team</p>')).toBe('R&D team');
  });

  it('parses an explicit salary range', () => {
    const salary = parseSalaryFromText('Compensation: $120,000 - $160,000 per year');
    expect(salary).toMatchObject({ min: 120_000, max: 160_000, currency: 'USD', period: SalaryPeriod.YEARLY });
  });

  it('expands a k-suffixed range', () => {
    expect(parseSalaryFromText('£70k - £90k')).toMatchObject({ min: 70_000, max: 90_000, currency: 'GBP' });
  });

  it('returns nothing rather than a wrong salary', () => {
    // No currency marker: these numbers could be anything.
    expect(parseSalaryFromText('We have 50 - 200 employees')).toBeUndefined();
    expect(parseSalaryFromText('Founded in 2015')).toBeUndefined();
  });

  it('rejects an inverted range', () => {
    expect(parseSalaryFromText('$90,000 - $40,000')).toBeUndefined();
  });

  it('only accepts a posting date the source really supplied', () => {
    expect(toPostedAt(undefined)).toBeUndefined();
    expect(toPostedAt('')).toBeUndefined();
    expect(toPostedAt('not a date')).toBeUndefined();
    expect(toPostedAt('2026-01-15T00:00:00Z')?.getUTCFullYear()).toBe(2026);
  });

  it('rejects an impossible posting date', () => {
    expect(toPostedAt('1970-01-01')).toBeUndefined();
    expect(toPostedAt(Date.now() + 7 * 86_400_000)).toBeUndefined();
  });

  it('hashes the same role identically regardless of source formatting', () => {
    expect(contentHash('Senior  Python Developer', 'Acme Inc.', 'London')).toBe(
      contentHash('senior python developer', 'ACME INC', 'london'),
    );
  });

  it('hashes different roles differently', () => {
    expect(contentHash('Backend Developer', 'Acme')).not.toBe(contentHash('Frontend Developer', 'Acme'));
  });
});

describe('deduplication', () => {
  it('drops a refetch of the same posting from one source', () => {
    const result = deduplicateJobs([job({ externalJobId: '1' }), job({ externalJobId: '1' })]);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('collapses the same role arriving from two sources', () => {
    const result = deduplicateJobs([
      job({ sourceKey: 'greenhouse', externalJobId: 'gh-1', location: 'London' }),
      job({ sourceKey: 'lever', externalJobId: 'lv-9', location: 'London' }),
    ]);

    expect(result.unique).toHaveLength(1);
    expect(result.nearDuplicates[0]?.reason).toBe('content-hash');
  });

  it('merges a near-duplicate title at the same company', () => {
    const result = deduplicateJobs([
      job({ externalJobId: '1', title: 'Senior Python Developer' }),
      job({ externalJobId: '2', title: 'Senior Python Developer (Remote)' }),
    ]);

    expect(result.unique).toHaveLength(1);
    expect(result.nearDuplicates[0]?.reason).toBe('title-similarity');
  });

  it('keeps genuinely different roles at the same company', () => {
    const result = deduplicateJobs([
      job({ externalJobId: '1', title: 'Backend Developer' }),
      job({ externalJobId: '2', title: 'Frontend Developer' }),
    ]);

    expect(result.unique).toHaveLength(2);
  });

  it('never merges across seniority, which would hide a job', () => {
    // The single most damaging false positive: a junior and a senior opening
    // are different vacancies, and collapsing them loses one entirely.
    expect(titleSimilarity('Junior Python Developer', 'Senior Python Developer')).toBe(0);

    const result = deduplicateJobs([
      job({ externalJobId: '1', title: 'Junior Python Developer' }),
      job({ externalJobId: '2', title: 'Senior Python Developer' }),
    ]);
    expect(result.unique).toHaveLength(2);
  });

  it('keeps the same title at different companies', () => {
    const result = deduplicateJobs([
      job({ externalJobId: '1', companyName: 'Acme' }),
      job({ externalJobId: '2', companyName: 'Globex' }),
    ]);
    expect(result.unique).toHaveLength(2);
  });
});

describe('robots.txt handling', () => {
  it('parses the wildcard group only', () => {
    const rules = parseRobots(
      ['User-agent: BadBot', 'Disallow: /', '', 'User-agent: *', 'Disallow: /private', 'Allow: /private/ok'].join('\n'),
    );
    expect(rules.disallow).toEqual(['/private']);
    expect(rules.allow).toEqual(['/private/ok']);
  });

  it('ignores comments', () => {
    expect(parseRobots('User-agent: *\nDisallow: /x # nope').disallow).toEqual(['/x']);
  });

  it('lets the longest matching rule win', () => {
    const rules = { disallow: ['/private'], allow: ['/private/ok'] };
    expect(isPathAllowed(rules, '/private/secret')).toBe(false);
    expect(isPathAllowed(rules, '/private/ok/page')).toBe(true);
    expect(isPathAllowed(rules, '/public')).toBe(true);
  });

  it('reads Retry-After in both formats', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('nonsense')).toBeNull();
  });
});

describe('PoliteHttpClient', () => {
  it('sends the configured User-Agent, so the traffic is attributable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const client = new PoliteHttpClient({
      userAgent: 'JobPilot/0.1 (+mailto:ops@example.com)',
      requestsPerMinute: 6000,
      maxRetries: 0,
      defaultTimeoutMs: 5000,
      respectRobotsTxt: false,
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.getJson('https://example.com/api');

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('User-Agent')).toContain('JobPilot');
  });

  it('retries a 500 and then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(
        new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const client = new PoliteHttpClient({
      userAgent: 'test',
      requestsPerMinute: 6000,
      maxRetries: 2,
      defaultTimeoutMs: 5000,
      respectRobotsTxt: false,
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getJson<{ ok: boolean }>('https://example.com/api')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404, which would only add load', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));

    const client = new PoliteHttpClient({
      userAgent: 'test',
      requestsPerMinute: 6000,
      maxRetries: 3,
      defaultTimeoutMs: 5000,
      respectRobotsTxt: false,
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getJson('https://example.com/missing')).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a path robots.txt disallows', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /jobs', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const client = new PoliteHttpClient({
      userAgent: 'test',
      requestsPerMinute: 6000,
      maxRetries: 0,
      defaultTimeoutMs: 5000,
      respectRobotsTxt: true,
      logger: silentLogger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getJson('https://example.com/jobs/1')).rejects.toThrow(/robots\.txt/);
  });
});

describe('partner adapters', () => {
  it.each([LINKEDIN, INDEED, GLASSDOOR])('$key is disabled without an agreement', async (adapter) => {
    expect(adapter.isConfigured({})).toBe(false);

    await expect(
      adapter.searchJobs(
        { keywords: 'python', limit: 10 },
        { http: {} as never, config: {}, logger: silentLogger },
      ),
    ).rejects.toBeInstanceOf(SourceNotConfiguredError);
  });

  it('reports why it is unavailable rather than failing silently', async () => {
    const health = await LINKEDIN.healthCheck({ http: {} as never, config: {}, logger: silentLogger });
    expect(health.healthy).toBe(false);
    expect(health.detail).toContain('partner agreement');
  });

  it('never claims to support automated applications', () => {
    for (const adapter of createDefaultAdapters()) {
      expect(adapter.capabilities.supportsAutomatedApplication).toBe(false);
    }
  });
});

describe('searchAllSources', () => {
  it('skips unconfigured sources instead of failing the whole search', async () => {
    const events: string[] = [];

    const outcome = await searchAllSources(createDefaultAdapters(), {
      query: { keywords: 'python', limit: 5 },
      config: {},
      logger: silentLogger,
      userAgent: 'test',
      onProgress: (event) => events.push(event.type),
    });

    expect(outcome.jobs).toEqual([]);
    expect(outcome.sourcesSkipped.map((entry) => entry.sourceKey)).toEqual(
      expect.arrayContaining(['greenhouse', 'lever', 'linkedin']),
    );
    expect(events).toContain('source-skipped');
    expect(events).toContain('completed');
  });

  it('reports a failing source without losing results from the others', async () => {
    const good = new GreenhouseAdapter();
    const bad = {
      ...new GreenhouseAdapter(),
      key: 'broken',
      displayName: 'Broken',
      isConfigured: () => true,
      searchJobs: () => Promise.reject(new Error('upstream exploded')),
      healthCheck: () => Promise.resolve({ healthy: false, detail: 'x', checkedAt: new Date() }),
    } as unknown as ReturnType<typeof createDefaultAdapters>[number];

    vi.spyOn(good, 'isConfigured').mockReturnValue(true);
    vi.spyOn(good, 'searchJobs').mockResolvedValue([job()]);

    const outcome = await searchAllSources([good, bad], {
      query: { keywords: 'python', limit: 5 },
      config: {},
      logger: silentLogger,
      userAgent: 'test',
    });

    expect(outcome.jobs).toHaveLength(1);
    expect(outcome.sourcesFailed).toEqual([
      { sourceKey: 'broken', reason: 'upstream exploded' },
    ]);
  });
});

describe('result budget fairness', () => {
  it('does not let the first source consume the whole limit', async () => {
    // Found against live data: with several boards configured, the first one
    // returned every job and the rest silently contributed nothing, so the
    // dashboard showed a single employer.
    const busy = {
      key: 'busy',
      displayName: 'Busy',
      kind: 'ATS_BOARD',
      termsUrl: '',
      capabilities: new GreenhouseAdapter().capabilities,
      isConfigured: () => true,
      searchJobs: (query: { limit: number }) =>
        Promise.resolve(
          Array.from({ length: query.limit }, (_, index) =>
            job({ sourceKey: 'busy', externalJobId: `b-${index}`, companyName: `Busy ${index}` }),
          ),
        ),
      healthCheck: () => Promise.resolve({ healthy: true, detail: '', checkedAt: new Date() }),
    } as unknown as ReturnType<typeof createDefaultAdapters>[number];

    const quiet = {
      ...busy,
      key: 'quiet',
      displayName: 'Quiet',
      searchJobs: () => Promise.resolve([job({ sourceKey: 'quiet', externalJobId: 'q-1', companyName: 'Quiet Co' })]),
    } as unknown as ReturnType<typeof createDefaultAdapters>[number];

    const outcome = await searchAllSources([busy, quiet], {
      query: { keywords: '', limit: 10 },
      config: {},
      logger: silentLogger,
      userAgent: 'test',
    });

    expect(outcome.sourcesSearched).toEqual(['busy', 'quiet']);
    // The quiet source must still have been asked, and its result kept.
    expect(outcome.dedupe.unique.some((entry) => entry.sourceKey === 'quiet')).toBe(true);
    expect(outcome.jobs.length).toBeLessThanOrEqual(10);
  });

  it('applies the limit after deduplication, not while collecting', async () => {
    const duplicating = {
      ...new GreenhouseAdapter(),
      key: 'dupes',
      isConfigured: () => true,
      searchJobs: () =>
        Promise.resolve([
          job({ externalJobId: '1', title: 'Same Role' }),
          job({ externalJobId: '2', title: 'Same Role' }),
          job({ externalJobId: '3', title: 'Different Role' }),
        ]),
      healthCheck: () => Promise.resolve({ healthy: true, detail: '', checkedAt: new Date() }),
    } as unknown as ReturnType<typeof createDefaultAdapters>[number];

    const outcome = await searchAllSources([duplicating], {
      query: { keywords: '', limit: 2 },
      config: {},
      logger: silentLogger,
      userAgent: 'test',
    });

    // Two unique jobs survive dedupe; the budget was not spent on the duplicate.
    expect(outcome.jobs).toHaveLength(2);
  });
});

describe('htmlToText on real board content', () => {
  it('handles HTML-ESCAPED descriptions, which Greenhouse returns', () => {
    // Found by looking at the rendered job detail panel: the description
    // showed a literal <div class="content-intro">. Stripping tags before
    // decoding entities meant the strip pass saw no tags, and the decode pass
    // then created them.
    const escaped = '&lt;div class="content-intro"&gt;&lt;p&gt;GitLab is a platform.&lt;/p&gt;&lt;/div&gt;';
    const text = htmlToText(escaped);

    expect(text).toBe('GitLab is a platform.');
    expect(text).not.toContain('<');
    expect(text).not.toContain('content-intro');
  });

  it('still handles ordinary unescaped HTML', () => {
    expect(htmlToText('<p>We need:</p><ul><li>Python</li></ul>')).toContain('Python');
    expect(htmlToText('<p>Hello</p>')).toBe('Hello');
  });

  it('handles content escaped twice over', () => {
    expect(htmlToText('&amp;lt;p&amp;gt;Nested&amp;lt;/p&amp;gt;')).toBe('Nested');
  });

  it('decodes numeric and hex entities', () => {
    expect(htmlToText('caf&#233; &#x26; bar')).toBe('café & bar');
  });

  it('drops control characters rather than emitting them', () => {
    expect(htmlToText('a&#1;b')).toBe('a b');
  });

  it('keeps list items readable', () => {
    expect(htmlToText('<ul><li>One</li><li>Two</li></ul>')).toContain('• One');
  });
});
