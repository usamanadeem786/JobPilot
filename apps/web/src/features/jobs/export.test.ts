import type { JobListItemDto } from '@jobpilot/shared';
import { describe, expect, it } from 'vitest';
import { escapeCsvField, jobsToCsv, neutraliseFormula } from './export';

function job(overrides: Partial<JobListItemDto> = {}): JobListItemDto {
  return {
    id: 'job-1',
    source: 'greenhouse',
    sourceDisplayName: 'Greenhouse',
    externalJobId: '1',
    title: 'Backend Engineer',
    companyName: 'Acme',
    companyWebsite: null,
    companyLogo: null,
    location: 'London',
    remoteType: 'REMOTE',
    employmentType: 'FULL_TIME',
    experienceLevel: 'SENIOR',
    salary: null,
    jobUrl: 'https://example.com/1',
    applicationUrl: 'https://example.com/1/apply',
    postedAt: '2026-08-20T00:00:00Z',
    postedAtKnown: true,
    discoveredAt: '2026-08-21T00:00:00Z',
    status: 'NEW',
    relevanceScore: 72,
    isFavourite: false,
    hasTailoredCv: false,
    applicationId: null,
    contact: null,
    notes: null,
    ...overrides,
  };
}

describe('neutraliseFormula', () => {
  it.each(['=1+1', '+SUM(A1)', '-2', '@import', '\tvalue', '\rvalue'])(
    'prefixes %j so a spreadsheet does not execute it',
    (value) => {
      // Excel and Sheets evaluate these as formulas, and job titles are
      // third-party input — exactly what that attack needs.
      expect(neutraliseFormula(value).startsWith("'")).toBe(true);
    },
  );

  it('leaves ordinary text alone', () => {
    expect(neutraliseFormula('Backend Engineer')).toBe('Backend Engineer');
    expect(neutraliseFormula('C++ Developer')).toBe('C++ Developer');
  });
});

describe('escapeCsvField', () => {
  it('quotes every field', () => {
    expect(escapeCsvField('plain')).toBe('"plain"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('keeps a comma inside the quoted field', () => {
    expect(escapeCsvField('London, UK')).toBe('"London, UK"');
  });

  it('neutralises a formula before quoting', () => {
    expect(escapeCsvField('=cmd')).toBe(`"'=cmd"`);
  });
});

describe('jobsToCsv', () => {
  it('starts with a BOM so Excel reads UTF-8 correctly', () => {
    expect(jobsToCsv([]).charCodeAt(0)).toBe(0xfeff);
  });

  it('writes a header row', () => {
    expect(jobsToCsv([])).toContain('"Title"');
    expect(jobsToCsv([])).toContain('"Recruiter email"');
  });

  it('uses CRLF line endings, which is what the CSV spec says', () => {
    expect(jobsToCsv([job()])).toContain('\r\n');
  });

  it('writes one row per job', () => {
    const csv = jobsToCsv([job({ id: 'a' }), job({ id: 'b' })]);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('leaves Posted blank when the source published no date', () => {
    // A column headed "Posted" implies the source published that date. For
    // many sources it did not, and filling it with the discovery date would
    // put a fabricated fact in a spreadsheet.
    const csv = jobsToCsv([job({ postedAt: null, postedAtKnown: false })]);
    const [, row] = csv.split('\r\n');
    const fields = row?.split('","') ?? [];
    expect(fields[7]).toBe('');
  });

  it('records whether a contact was verified, not just its address', () => {
    const csv = jobsToCsv([
      job({
        contact: {
          name: 'Jane Smith',
          title: null,
          email: 'jane@acme.com',
          source: 'job-description',
          confidence: 0.7,
          provenance: 'KNOWN',
        },
      }),
    ]);

    expect(csv).toContain('jane@acme.com');
    // KNOWN is not VERIFIED, and the export must not blur that.
    expect(csv).toContain('"false"');
  });

  it('handles a job with no optional data', () => {
    expect(() =>
      jobsToCsv([job({ location: null, salary: null, relevanceScore: null, contact: null })]),
    ).not.toThrow();
  });
});
