import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractCvText } from './index';
import { parseCv } from '../parse';

/**
 * Two-column CVs.
 *
 * This is not an exotic layout — a large share of modern CV templates put a
 * sidebar of skills and education beside the main body. Read by baseline
 * alone, the two columns interleave: "WORK EXPERIENCE" and "TECHNICAL SKILLS"
 * arrive as a single line, every heading collides with its neighbour, and the
 * parser reports no experience at all in a CV that plainly lists three jobs.
 *
 * The PDFs here are built rather than fixtured, so the test exercises the real
 * geometry the extractor has to reason about.
 */

interface Placement {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
}

async function pdfWith(placements: readonly Placement[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const placement of placements) {
    page.drawText(placement.text, {
      x: placement.x,
      y: placement.y,
      size: placement.size ?? 10,
      font,
    });
  }

  return Buffer.from(await pdf.save());
}

/** Sidebar on the left, body on the right, as most templates lay it out. */
const LEFT_COLUMN = 50;
const RIGHT_COLUMN = 320;

async function twoColumnCv(): Promise<Buffer> {
  const placements: Placement[] = [
    { text: 'JANE COOPER', x: LEFT_COLUMN, y: 800, size: 18 },

    // Left: contact, skills, education.
    { text: 'jane@example.com', x: LEFT_COLUMN, y: 770 },
    { text: 'TECHNICAL SKILLS', x: LEFT_COLUMN, y: 730, size: 12 },
    { text: 'Python, Django, REST', x: LEFT_COLUMN, y: 712 },
    { text: 'PostgreSQL, Redis', x: LEFT_COLUMN, y: 698 },
    { text: 'EDUCATION', x: LEFT_COLUMN, y: 660, size: 12 },
    { text: 'BSc Computer Science', x: LEFT_COLUMN, y: 642 },
    { text: 'University of Leeds', x: LEFT_COLUMN, y: 628 },

    // Right: summary and the work history, at overlapping heights.
    { text: 'SUMMARY', x: RIGHT_COLUMN, y: 730, size: 12 },
    { text: 'Backend engineer with eight years', x: RIGHT_COLUMN, y: 712 },
    { text: 'building payment systems.', x: RIGHT_COLUMN, y: 698 },
    { text: 'WORK EXPERIENCE', x: RIGHT_COLUMN, y: 660, size: 12 },
    { text: 'Senior Engineer March 2021 - Present', x: RIGHT_COLUMN, y: 642 },
    { text: 'Monzo', x: RIGHT_COLUMN, y: 628 },
    { text: 'Rebuilt the payout pipeline.', x: RIGHT_COLUMN, y: 614 },
    { text: 'Engineer July 2018 - February 2021', x: RIGHT_COLUMN, y: 586 },
    { text: 'Deliveroo', x: RIGHT_COLUMN, y: 572 },
    { text: 'Built an ETL pipeline.', x: RIGHT_COLUMN, y: 558 },
  ];

  return pdfWith(placements);
}

describe('two-column layouts', () => {
  it('does not splice the two columns into one line', async () => {
    const { text } = await extractCvText(await twoColumnCv(), 'application/pdf');

    // The exact failure: the two headings sat at the same height and were
    // emitted as "WORK EXPERIENCE TECHNICAL SKILLS".
    for (const line of text.split('\n')) {
      expect(line).not.toMatch(/TECHNICAL SKILLS.*WORK EXPERIENCE/);
      expect(line).not.toMatch(/WORK EXPERIENCE.*TECHNICAL SKILLS/);
    }

    expect(text).toContain('TECHNICAL SKILLS');
    expect(text).toContain('WORK EXPERIENCE');
  });

  it('recovers the work history a spliced read loses entirely', async () => {
    const { text } = await extractCvText(await twoColumnCv(), 'application/pdf');
    const { document } = parseCv(text);

    expect(document.experience.map((role) => role.company)).toEqual(['Monzo', 'Deliveroo']);
    expect(document.experience[0]?.title).toBe('Senior Engineer');
  });

  it('still reads the sidebar', async () => {
    const { text } = await extractCvText(await twoColumnCv(), 'application/pdf');
    const { document } = parseCv(text);

    expect(document.skillGroups.flatMap((group) => group.skills)).toContain('Python');
    expect(document.education[0]?.institution).toBe('University of Leeds');
  });

  it('leaves a single-column CV alone', async () => {
    // The guard that matters: right-aligned dates leave whitespace down the
    // middle of a one-column page, and must not be mistaken for a gutter.
    const single = await pdfWith([
      { text: 'JANE COOPER', x: 50, y: 800, size: 18 },
      { text: 'jane@example.com', x: 50, y: 780 },
      { text: 'EXPERIENCE', x: 50, y: 740, size: 12 },
      { text: 'Senior Engineer', x: 50, y: 720 },
      { text: 'March 2021 - Present', x: 400, y: 720 },
      { text: 'Monzo', x: 50, y: 706 },
      { text: 'Rebuilt the payout pipeline end to end for the payments team.', x: 50, y: 692 },
      { text: 'Introduced contract testing across fourteen separate services.', x: 50, y: 678 },
      { text: 'Engineer', x: 50, y: 650 },
      { text: 'July 2018 - February 2021', x: 400, y: 650 },
      { text: 'Deliveroo', x: 50, y: 636 },
      { text: 'Built an ETL pipeline processing telemetry from the estate.', x: 50, y: 622 },
      { text: 'EDUCATION', x: 50, y: 580, size: 12 },
      { text: 'BSc Computer Science', x: 50, y: 562 },
      { text: 'University of Leeds', x: 50, y: 548 },
    ]);

    const { text } = await extractCvText(single, 'application/pdf');
    const { document } = parseCv(text);

    expect(document.experience.map((role) => role.company)).toEqual(['Monzo', 'Deliveroo']);
  });
});

describe('letter-spaced headings', () => {
  it('rejoins a tracked-out job title', async () => {
    // Designers track out headings; each glyph then sits at its own position
    // and a faithful read gives "S o f t w a r e E n g i n e e r".
    const spaced = 'Software Engineer'.split('').join(' ');
    const pdf = await pdfWith([
      { text: 'JANE COOPER', x: 50, y: 800, size: 18 },
      { text: spaced, x: 50, y: 778 },
      { text: 'jane@example.com', x: 50, y: 758 },
      // Body text so the document clears the "this is a scan" floor. Without
      // it the page holds 43 characters, extraction rejects it as an image
      // before letter spacing is ever considered, and the test fails for a
      // reason that has nothing to do with what it is checking.
      { text: 'Backend engineer with eight years building payment systems.', x: 50, y: 740 },
    ]);

    const { text } = await extractCvText(pdf, 'application/pdf');

    expect(text).toContain('Software Engineer');
    expect(text).not.toContain('S o f t w a r e');
  });

  it('leaves ordinary prose with short words alone', async () => {
    const pdf = await pdfWith([
      { text: 'JANE COOPER', x: 50, y: 800, size: 18 },
      { text: 'I own a plan to do a lot of work in a big team', x: 50, y: 778 },
      { text: 'jane@example.com', x: 50, y: 758 },
    ]);

    const { text } = await extractCvText(pdf, 'application/pdf');

    expect(text).toContain('I own a plan to do a lot of work in a big team');
  });
});
