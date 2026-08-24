import { describe, expect, it } from 'vitest';
import { ApplyMethod, EmploymentType, ExperienceLevel, RemoteType } from '@jobpilot/shared';
import { matchesQuery, relevanceOf, selectBestMatches } from './relevance';
import type { NormalisedJob, NormalisedQuery } from './types';

function job(overrides: Partial<NormalisedJob> & { title: string }): NormalisedJob {
  return {
    sourceKey: 'greenhouse',
    externalJobId: overrides.title,
    companyName: 'Acme',
    remoteType: RemoteType.UNKNOWN,
    employmentType: EmploymentType.UNKNOWN,
    experienceLevel: ExperienceLevel.UNKNOWN,
    description: '',
    jobUrl: 'https://example.com/job',
    applicationUrl: 'https://example.com/job',
    applyMethod: ApplyMethod.EXTERNAL_URL,
    postedAtKnown: false,
    contentHash: overrides.title,
    ...overrides,
  };
}

function query(keywords: string, extra: Partial<NormalisedQuery> = {}): NormalisedQuery {
  return { keywords, limit: 50, ...extra };
}

describe('a keyword has to earn its place in the title', () => {
  // The failure this encodes: a live search for "engineer" against three
  // Greenhouse boards returned 26 Account Executive roles out of 31, because
  // every sales posting at a technology company says "work with engineers"
  // somewhere in its description.
  it('rejects a sales role that merely mentions engineers', () => {
    const salesRole = job({
      title: 'Account Executive, Enterprise',
      description: 'You will partner with our engineers to close deals.',
    });

    expect(matchesQuery(salesRole, query('engineer'))).toBe(false);
  });

  it('accepts the role the search was actually for', () => {
    expect(matchesQuery(job({ title: 'Backend Engineer' }), query('engineer'))).toBe(true);
  });

  it('lets a description supply the terms the title does not name', () => {
    const role = job({
      title: 'Senior Engineer',
      description: 'Our stack is Python and Postgres.',
    });

    // "senior" and "engineer" are in the title, "python" only in the body —
    // which is how CVs and job ads actually read.
    expect(matchesQuery(role, query('senior python engineer'))).toBe(true);
  });

  it('still requires every term to appear somewhere', () => {
    const role = job({ title: 'Senior Engineer', description: 'Our stack is Go.' });
    expect(matchesQuery(role, query('senior python engineer'))).toBe(false);
  });

  it('matches whole words only', () => {
    // Without a word boundary "go" matches "going", "category" and "Django",
    // which turns a language search into noise.
    const role = job({ title: 'Category Manager', description: 'Ongoing work.' });
    expect(matchesQuery(role, query('go'))).toBe(false);
    expect(matchesQuery(job({ title: 'Go Engineer' }), query('go'))).toBe(true);
  });
});

describe('ranking', () => {
  it('puts an exact title phrase first', () => {
    const exact = job({ title: 'Backend Engineer' });
    const partial = job({ title: 'Engineer, Platform', description: 'backend work' });

    expect(relevanceOf(exact, query('backend engineer'))).toBeGreaterThan(
      relevanceOf(partial, query('backend engineer')),
    );
  });

  it('ranks a title match above a description match', () => {
    const inTitle = job({ title: 'Python Engineer' });
    const inBody = job({ title: 'Software Engineer', description: 'python' });

    expect(relevanceOf(inTitle, query('python'))).toBeGreaterThan(
      relevanceOf(inBody, query('python')),
    );
  });

  it('does not let recency overturn relevance', () => {
    const relevantOld = job({ title: 'Staff Engineer', postedAtKnown: false });
    const vagueNew = job({
      title: 'Engineer',
      description: 'staff',
      postedAtKnown: true,
      postedAt: new Date(),
    });

    expect(relevanceOf(relevantOld, query('staff engineer'))).toBeGreaterThan(
      relevanceOf(vagueNew, query('staff engineer')),
    );
  });
});

describe('selectBestMatches', () => {
  it('ranks before it truncates', () => {
    // Alphabetical order, which is how boards list roles. Cutting at the limit
    // while iterating kept exactly the wrong two.
    const board = [
      job({ title: 'Account Executive', description: 'engineer' }),
      job({ title: 'Account Manager', description: 'engineer' }),
      job({ title: 'Backend Engineer' }),
      job({ title: 'Frontend Engineer' }),
    ];

    const chosen = selectBestMatches(board, query('engineer'), 2);

    expect(chosen.map((entry) => entry.title)).toEqual(['Backend Engineer', 'Frontend Engineer']);
  });

  it('returns nothing rather than filler when nothing matches', () => {
    const board = [job({ title: 'Account Executive', description: 'engineer' })];
    expect(selectBestMatches(board, query('engineer'), 10)).toEqual([]);
  });

  it('keeps a salary-less job in a salary-filtered search', () => {
    // A posting that never stated its salary is not evidence of a low one.
    const unstated = job({ title: 'Engineer' });
    expect(matchesQuery(unstated, query('engineer', { minSalary: 200_000 }))).toBe(true);
  });
});
