import { Provenance } from '@jobpilot/shared';
import { describe, expect, it } from 'vitest';
import { allEmployers, allSkills } from '../schema';
import { parseCv, parseCvDate } from './index';
import { matchHeading, splitIntoSections, toBullets } from './sections';
import { extractEmail, extractLinks, extractName, extractPhone } from './contact';

/** A realistic CV in the shape text extraction produces: layout flattened. */
const SAMPLE_CV = `Usama Nadeem
Senior Python Backend Developer
Lahore, Pakistan | usama@example.com | +92 300 1234567
https://github.com/usamanadeem786 | https://linkedin.com/in/usama

PROFESSIONAL SUMMARY
Backend engineer with six years building APIs in Python. Focused on Django and
FastAPI services backed by PostgreSQL.

TECHNICAL SKILLS
Languages: Python, TypeScript, SQL
Frameworks: Django, FastAPI, Celery
Databases: PostgreSQL, Redis, MongoDB
Docker, Kubernetes, AWS

WORK EXPERIENCE
Senior Backend Engineer at Acme Systems, Lahore
Mar 2022 - Present
• Led the migration of a Django monolith to six FastAPI services
• Cut p95 checkout latency from 840ms to 120ms
• Mentored four junior engineers

Backend Developer | Globex Ltd
Jun 2019 - Feb 2022
• Built a billing API handling 2M requests per day
• Introduced pytest coverage gates, raising coverage from 31% to 86%

EDUCATION
University of the Punjab | BSc Computer Science | 2015 - 2019

CERTIFICATIONS
• AWS Certified Solutions Architect - Associate
• Certified Kubernetes Application Developer

ACHIEVEMENTS
• Speaker at PyCon Pakistan 2023
• Maintainer of an open-source Django package with 1.2k stars
`;

describe('parseCv', () => {
  const parsed = parseCv(SAMPLE_CV);

  it('reads the personal details without inventing any', () => {
    expect(parsed.document.personal.fullName).toBe('Usama Nadeem');
    expect(parsed.document.personal.headline).toBe('Senior Python Backend Developer');
    expect(parsed.document.personal.email).toBe('usama@example.com');
    expect(parsed.document.personal.phone).toContain('300');
  });

  it('labels known links by provider', () => {
    const labels = parsed.document.personal.links.map((link) => link.label);
    expect(labels).toContain('GitHub');
    expect(labels).toContain('LinkedIn');
  });

  it('captures the summary', () => {
    expect(parsed.document.summary).toContain('six years building APIs');
  });

  it('groups skills by their category label', () => {
    const categories = parsed.document.skillGroups.map((group) => group.category);
    expect(categories).toContain('Languages');
    expect(categories).toContain('Databases');

    const languages = parsed.document.skillGroups.find((g) => g.category === 'Languages');
    expect(languages?.skills).toEqual(['Python', 'TypeScript', 'SQL']);
  });

  it('keeps an uncategorised skills line as its own group', () => {
    expect(allSkills(parsed.document)).toEqual(expect.arrayContaining(['Docker', 'Kubernetes', 'AWS']));
  });

  it('splits experience into one entry per role', () => {
    expect(parsed.document.experience).toHaveLength(2);
    expect(allEmployers(parsed.document)).toEqual(
      expect.arrayContaining(['acme systems', 'globex ltd']),
    );
  });

  it('reads the role title, dates and current flag', () => {
    const [recent] = parsed.document.experience;
    expect(recent?.title).toBe('Senior Backend Engineer');
    expect(recent?.company).toBe('Acme Systems');
    expect(recent?.startDate?.year).toBe(2022);
    expect(recent?.startDate?.month).toBe(3);
    expect(recent?.isCurrent).toBe(true);
  });

  it('marks a finished role as not current', () => {
    const previous = parsed.document.experience[1];
    expect(previous?.isCurrent).toBe(false);
    expect(previous?.endDate?.year).toBe(2022);
  });

  it('attaches bullets to the role they belong to', () => {
    expect(parsed.document.experience[0]?.bullets).toHaveLength(3);
    expect(parsed.document.experience[0]?.bullets[1]).toContain('840ms to 120ms');
    expect(parsed.document.experience[1]?.bullets).toHaveLength(2);
  });

  it('reads education, certifications and achievements', () => {
    expect(parsed.document.education[0]?.institution).toBe('University of the Punjab');
    expect(parsed.document.certifications).toHaveLength(2);
    expect(parsed.document.achievements).toHaveLength(2);
    expect(parsed.document.achievements[0]).toContain('PyCon');
  });

  it('strips bullet glyphs from the stored text', () => {
    for (const bullet of parsed.document.experience.flatMap((item) => item.bullets)) {
      expect(bullet.startsWith('•')).toBe(false);
    }
  });

  it('records provenance for what was found', () => {
    expect(parsed.provenance.personal).toBe(Provenance.KNOWN);
    expect(parsed.provenance.experience).toBe(Provenance.KNOWN);
    expect(parsed.provenance.skills).toBe(Provenance.KNOWN);
  });

  it('marks absent sections NOT_FOUND rather than inventing them', () => {
    // The sample has no projects section.
    expect(parsed.document.projects).toEqual([]);
    expect(parsed.provenance.projects).toBe(Provenance.NOT_FOUND);
  });

  it('orders only the sections that have content', () => {
    expect(parsed.document.sectionOrder).not.toContain('projects');
    expect(parsed.document.sectionOrder).toContain('experience');
  });

  it('produces a document that satisfies the schema', () => {
    // parseCv runs the schema itself; this asserts it did not bypass it.
    expect(() => parseCv(SAMPLE_CV)).not.toThrow();
  });
});

describe('parseCv on difficult input', () => {
  it('does not throw on an empty document', () => {
    const result = parseCv('');
    expect(result.document.personal.fullName).toBe('Unknown');
    expect(result.provenance.personal).toBe(Provenance.NOT_FOUND);
  });

  it('handles a CV with no recognised headings', () => {
    const result = parseCv('Jane Doe\njane@example.com\nI write software.');
    expect(result.document.personal.fullName).toBe('Jane Doe');
    expect(result.document.experience).toEqual([]);
  });

  it('merges a heading that repeats across pages', () => {
    const text = [
      'Jane Doe',
      'EXPERIENCE',
      'Engineer at A Ltd',
      '2020 - 2021',
      '• Did a thing',
      'EXPERIENCE',
      'Engineer at B Ltd',
      '2018 - 2020',
      '• Did another thing',
    ].join('\n');

    expect(parseCv(text).document.experience).toHaveLength(2);
  });

  it('ignores a sentence that merely contains a heading word', () => {
    const text = 'Jane Doe\nSUMMARY\nI have deep experience in backend systems.\n';
    const result = parseCv(text);
    // "experience" inside prose must not open an experience section.
    expect(result.document.summary).toContain('deep experience');
    expect(result.document.experience).toEqual([]);
  });
});

describe('matchHeading', () => {
  it.each(['EXPERIENCE', 'Work Experience', 'professional experience', 'EMPLOYMENT  '])(
    'recognises %j as experience',
    (line) => {
      expect(matchHeading(line)).toBe('experience');
    },
  );

  it.each(['SKILLS', 'Technical Skills', 'Key Skills'])('recognises %j as skills', (line) => {
    expect(matchHeading(line)).toBe('skills');
  });

  it('tolerates decoration around the heading', () => {
    expect(matchHeading('— EDUCATION —')).toBe('education');
    expect(matchHeading('Education:')).toBe('education');
  });

  it.each([
    'I have 6 years of experience building APIs',
    'My skills include Python and Go.',
    'Education was the best part of my career journey so far',
  ])('rejects prose: %j', (line) => {
    expect(matchHeading(line)).toBeNull();
  });
});

describe('splitIntoSections', () => {
  it('returns everything before the first heading as the header', () => {
    const { header, sections } = splitIntoSections('Jane Doe\njane@x.com\nSKILLS\nPython');
    expect(header).toEqual(['Jane Doe', 'jane@x.com']);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.section).toBe('skills');
  });
});

describe('toBullets', () => {
  it('strips the many bullet glyphs CVs use', () => {
    expect(toBullets(['• one', '- two', '– three', '* four', '▪ five'])).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ]);
  });

  it('drops blank lines', () => {
    expect(toBullets(['', '• kept', '   '])).toEqual(['kept']);
  });
});

describe('parseCvDate', () => {
  it.each([
    ['Mar 2022', 2022, 3],
    ['January 2019', 2019, 1],
    ['03/2019', 2019, 3],
    ['2015', 2015, undefined],
  ])('parses %j', (raw, year, month) => {
    const parsed = parseCvDate(raw);
    expect(parsed?.year).toBe(year);
    expect(parsed?.month).toBe(month);
  });

  it('keeps unparseable text without guessing a date', () => {
    const parsed = parseCvDate('Present');
    expect(parsed?.raw).toBe('Present');
    expect(parsed?.year).toBeUndefined();
  });
});

describe('contact extraction', () => {
  it('finds an email', () => {
    expect(extractEmail('reach me at a.b+c@example.co.uk please')).toBe('a.b+c@example.co.uk');
  });

  it('finds an international phone number', () => {
    expect(extractPhone('+92 300 1234567')).toContain('300');
  });

  it('does not mistake an email or URL for a phone number', () => {
    expect(extractPhone('user2024@example.com')).toBeUndefined();
    expect(extractPhone('https://example.com/2024/01/15')).toBeUndefined();
  });

  it('does not mistake a year for a phone number', () => {
    expect(extractPhone('Graduated 2019')).toBeUndefined();
  });

  it('deduplicates links', () => {
    const links = extractLinks('https://github.com/x and https://github.com/x again');
    expect(links).toHaveLength(1);
  });

  it('skips document titles when looking for the name', () => {
    expect(extractName(['CURRICULUM VITAE', 'Ada Lovelace', 'ada@x.com'])).toBe('Ada Lovelace');
  });

  it('does not treat a contact line as the name', () => {
    expect(extractName(['ada@example.com', 'Ada Lovelace'])).toBe('Ada Lovelace');
  });
});
