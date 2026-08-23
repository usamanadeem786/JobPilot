import { describe, expect, it } from 'vitest';
import { parseCv } from './index';

/**
 * Layout regressions.
 *
 * Every case here comes from a real round trip that produced wrong output —
 * a company invented from an achievement, a city filed as a degree, a whole
 * CV read as one line. The unit tests passed throughout, because they fed the
 * parser text already shaped the way it expected. These feed it the shapes
 * documents actually produce.
 */
describe('two-line role headers', () => {
  it('reads the employer from the line below the dates', () => {
    const { document } = parseCv(
      [
        'Jane Cooper',
        'jane@example.com',
        '',
        'EXPERIENCE',
        'Senior Software Engineer March 2021 – Present',
        'Careem',
        '• Rebuilt the driver payout pipeline.',
        'Software Engineer July 2018 – February 2021',
        'Arbisoft',
        '• Built an ETL pipeline.',
      ].join('\n'),
    );

    expect(document.experience).toHaveLength(2);
    expect(document.experience[0]?.title).toBe('Senior Software Engineer');
    expect(document.experience[0]?.company).toBe('Careem');
    expect(document.experience[1]?.title).toBe('Software Engineer');
    expect(document.experience[1]?.company).toBe('Arbisoft');
  });

  it('never takes an achievement as the employer', () => {
    // The layout that broke it: no bullet markers, so the sentence under the
    // date line looks exactly like a company name would.
    const { document } = parseCv(
      [
        'Jane Cooper',
        '',
        'EXPERIENCE',
        'Senior Software Engineer — Careem March 2021 – Present',
        'Rebuilt the driver payout pipeline.',
        'Introduced contract testing across 14 services.',
        'Software Engineer — Arbisoft July 2018 – February 2021',
        'Built an ETL pipeline.',
      ].join('\n'),
    );

    const companies = document.experience.map((role) => role.company);
    expect(companies).toEqual(['Careem', 'Arbisoft']);
    expect(companies.join(' ')).not.toContain('Rebuilt');
    expect(companies.join(' ')).not.toContain('contract testing');
  });

  it('does not reach across a blank line for an employer', () => {
    const { document } = parseCv(
      ['Jane Cooper', '', 'EXPERIENCE', 'Consultant 2019 – 2020', '', 'Advised on strategy.'].join(
        '\n',
      ),
    );

    expect(document.experience[0]?.company).not.toBe('Advised on strategy.');
  });
});

describe('a date does not eat the word before it', () => {
  // The month in a date range is an optional run of 3–9 letters. Unanchored,
  // it matches inside the preceding word, and stripping the range takes the
  // tail of that word with it: "Cambridge University 2019 – 2020" became
  // "Cambridge U".
  it.each([
    ['Cambridge University 2019 – 2020', 'Cambridge University'],
    ['Massachusetts Institute of Technology 2015 – 2019', 'Massachusetts Institute of Technology'],
  ])('keeps the institution intact in %s', (line, expected) => {
    const { document } = parseCv(['Jane Cooper', '', 'EDUCATION', line].join('\n'));
    expect(document.education[0]?.institution).toBe(expected);
  });

  it('keeps a long qualification intact', () => {
    const { document } = parseCv(
      ['Jane Cooper', '', 'EDUCATION', 'MSc Artificial Intelligence', 'Cambridge University'].join(
        '\n',
      ),
    );

    expect(document.education[0]?.qualification).toBe('MSc Artificial Intelligence');
  });

  it('still reads a month name that really is one', () => {
    const { document } = parseCv(
      ['Jane Cooper', '', 'EXPERIENCE', 'Engineer March 2021 – Present', 'Acme'].join('\n'),
    );

    expect(document.experience[0]?.startDate?.year).toBe(2021);
    expect(document.experience[0]?.startDate?.month).toBe(3);
    expect(document.experience[0]?.isCurrent).toBe(true);
  });
});

describe('education entries split over two lines', () => {
  it('pairs a qualification with the institution beneath it', () => {
    const { document } = parseCv(
      ['Jane Cooper', '', 'EDUCATION', 'BSc Computer Science', 'UET Lahore'].join('\n'),
    );

    expect(document.education).toHaveLength(1);
    expect(document.education[0]?.qualification).toBe('BSc Computer Science');
    expect(document.education[0]?.institution).toBe('UET Lahore');
  });

  it('keeps a comma inside an institution name', () => {
    const { document } = parseCv(
      [
        'Jane Cooper',
        '',
        'EDUCATION',
        'BSc Computer Science',
        'University of Engineering and Technology, Lahore',
      ].join('\n'),
    );

    expect(document.education).toHaveLength(1);
    expect(document.education[0]?.institution).toBe(
      'University of Engineering and Technology, Lahore',
    );
    expect(document.education[0]?.qualification).toBe('BSc Computer Science');
  });

  it('still splits a single line that holds both halves', () => {
    const { document } = parseCv(
      ['Jane Cooper', '', 'EDUCATION', 'University of Oxford — MSc Computer Science, 2018'].join(
        '\n',
      ),
    );

    expect(document.education[0]?.institution).toBe('University of Oxford');
    expect(document.education[0]?.qualification).toContain('MSc Computer Science');
  });

  it('keeps a degree whose institution was never written down', () => {
    const { document } = parseCv(['Jane Cooper', '', 'EDUCATION', 'PhD Mathematics'].join('\n'));

    expect(document.education).toHaveLength(1);
    expect(document.education[0]?.qualification).toBe('PhD Mathematics');
  });

  it('attaches a grade to the degree above it', () => {
    const { document } = parseCv(
      [
        'Jane Cooper',
        '',
        'EDUCATION',
        'BSc Computer Science',
        'UET Lahore',
        'First class honours',
        'MSc Artificial Intelligence',
        'Cambridge University',
        'Distinction',
      ].join('\n'),
    );

    expect(document.education).toHaveLength(2);
    expect(document.education[0]?.grade).toBe('First class honours');
    expect(document.education[1]?.grade).toBe('Distinction');
    // The failure this guards: a university called "First class honours".
    expect(document.education.map((item) => item.institution)).toEqual([
      'UET Lahore',
      'Cambridge University',
    ]);
  });
});

describe('employer and location on one line', () => {
  it('splits a middot-separated employer and location', () => {
    const { document } = parseCv(
      [
        'Jane Cooper',
        '',
        'EXPERIENCE',
        'Senior Engineer March 2021 – Present',
        'Careem · Lahore, Pakistan',
        '• Did a thing.',
      ].join('\n'),
    );

    expect(document.experience[0]?.company).toBe('Careem');
    expect(document.experience[0]?.location).toBe('Lahore, Pakistan');
  });
});
