import { describe, expect, it } from 'vitest';
import { CvDocumentSchema, type CvDocument } from '../schema';
import { renderCvToDocx } from './docx';
import { layoutCv } from './layout';
import { renderCvToPdf, toStandardFontSafe, wrap } from './pdf';
import { CV_TEMPLATES, getTemplate } from './templates';

const cv: CvDocument = CvDocumentSchema.parse({
  personal: {
    fullName: 'Usama Nadeem',
    headline: 'Senior Python Backend Developer',
    email: 'usama@example.com',
    phone: '+92 300 1234567',
    location: 'Lahore, Pakistan',
    links: [{ label: 'GitHub', url: 'https://github.com/example' }],
  },
  summary: 'Backend engineer with six years building Python services.',
  skillGroups: [{ category: 'Languages', skills: ['Python', 'TypeScript'] }],
  experience: [
    {
      company: 'Acme Systems',
      title: 'Senior Backend Engineer',
      location: 'Lahore',
      startDate: { raw: 'Mar 2022', year: 2022, month: 3 },
      isCurrent: true,
      bullets: ['Cut p95 latency from 840ms to 120ms', 'Mentored four junior engineers'],
    },
  ],
  education: [{ institution: 'University of the Punjab', qualification: 'BSc', field: 'Computer Science' }],
  certifications: [{ name: 'AWS Certified Solutions Architect' }],
  achievements: ['Spoke at PyCon Pakistan 2023'],
});

describe('templates', () => {
  it('ships the five templates the brief specified', () => {
    expect(CV_TEMPLATES).toHaveLength(5);
    expect(CV_TEMPLATES.map((template) => template.key)).toEqual([
      'modern-ats',
      'professional',
      'minimal',
      'software-engineer',
      'executive',
    ]);
  });

  it('falls back to the default for an unknown key', () => {
    expect(getTemplate('does-not-exist').key).toBe('modern-ats');
    expect(getTemplate(undefined).key).toBe('modern-ats');
  });

  it('promotes skills above education for the engineering template', () => {
    const order = getTemplate('software-engineer').sectionOrder;
    expect(order.indexOf('skills')).toBeLessThan(order.indexOf('education'));
  });

  it('leads with achievements for the executive template', () => {
    const order = getTemplate('executive').sectionOrder;
    expect(order.indexOf('achievements')).toBeLessThan(order.indexOf('experience'));
  });
});

describe('layoutCv', () => {
  it('starts with the name and contact details', () => {
    const blocks = layoutCv(cv, getTemplate('modern-ats'));
    expect(blocks[0]).toEqual({ kind: 'name', text: 'Usama Nadeem' });
    expect(blocks[1]?.kind).toBe('contact');
  });

  it('skips empty sections rather than leaving a bare heading', () => {
    // A CV with an empty "Certifications" heading reads as unfinished.
    const sparse = CvDocumentSchema.parse({ personal: { fullName: 'Nobody' } });
    const headings = layoutCv(sparse, getTemplate('modern-ats')).filter((b) => b.kind === 'heading');
    expect(headings).toEqual([]);
  });

  it('honours the document section order over the template default', () => {
    const reordered = CvDocumentSchema.parse({ ...cv, sectionOrder: ['skills', 'summary'] });
    const headings = layoutCv(reordered, getTemplate('executive'))
      .filter((block) => block.kind === 'heading')
      .map((block) => (block.kind === 'heading' ? block.text : ''));

    expect(headings).toEqual(['Skills', 'Professional Summary']);
  });

  it('renders every bullet of every role', () => {
    const bullets = layoutCv(cv, getTemplate('modern-ats')).filter((b) => b.kind === 'bullet');
    expect(bullets.map((b) => (b.kind === 'bullet' ? b.text : ''))).toEqual(
      expect.arrayContaining(['Cut p95 latency from 840ms to 120ms', 'Spoke at PyCon Pakistan 2023']),
    );
  });

  it('shows Present for a current role', () => {
    const entry = layoutCv(cv, getTemplate('modern-ats')).find(
      (block) => block.kind === 'entry' && block.primary === 'Senior Backend Engineer',
    );
    expect(entry?.kind === 'entry' ? entry.trailing : '').toContain('Present');
  });
});

describe('renderCvToDocx', () => {
  it('produces a valid DOCX file', async () => {
    const buffer = await renderCvToDocx(cv);
    // A .docx is a zip: PK\x03\x04.
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(buffer.length).toBeGreaterThan(3_000);
  });

  it('contains the CV content', async () => {
    const buffer = await renderCvToDocx(cv);
    // Deflated, but the office XML part names are stored uncompressed.
    expect(buffer.toString('latin1')).toContain('word/document.xml');
  });

  it('renders for every template', async () => {
    for (const template of CV_TEMPLATES) {
      const buffer = await renderCvToDocx(cv, { templateKey: template.key });
      expect(buffer.length).toBeGreaterThan(3_000);
    }
  });

  it('renders a nearly empty CV without throwing', async () => {
    const sparse = CvDocumentSchema.parse({ personal: { fullName: 'Nobody' } });
    await expect(renderCvToDocx(sparse)).resolves.toBeInstanceOf(Buffer);
  });
});

describe('renderCvToPdf', () => {
  it('produces a valid PDF file', async () => {
    const buffer = await renderCvToPdf(cv);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1_000);
  });

  it('renders for every template', async () => {
    for (const template of CV_TEMPLATES) {
      const buffer = await renderCvToPdf(cv, { templateKey: template.key });
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });

  it('paginates rather than overflowing when the CV is long', async () => {
    const long = CvDocumentSchema.parse({
      ...cv,
      experience: Array.from({ length: 25 }, (_, index) => ({
        company: `Company ${index}`,
        title: 'Backend Engineer',
        isCurrent: false,
        startDate: { raw: '2015' },
        endDate: { raw: '2016' },
        bullets: Array.from({ length: 6 }, (__, b) => `Delivered project ${b} with measurable impact on throughput`),
      })),
    });

    const buffer = await renderCvToPdf(long);

    // Load the result back rather than grepping the bytes: pdf-lib compresses
    // object streams, so the page objects are not visible as plain text.
    const { PDFDocument } = await import('pdf-lib');
    const parsed = await PDFDocument.load(buffer);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });

  it('does not throw on characters outside the standard font encoding', async () => {
    // The standard PDF fonts reject anything outside WinAnsi, and a CV with an
    // em dash or a CJK name must not fail the whole render.
    const awkward = CvDocumentSchema.parse({
      personal: { fullName: 'Zoë Müller' },
      summary: 'Delivered “quality” — consistently… 日本語 included.',
    });

    await expect(renderCvToPdf(awkward)).resolves.toBeInstanceOf(Buffer);
  });
});

describe('toStandardFontSafe', () => {
  it('folds typographic characters to ASCII', () => {
    expect(toStandardFontSafe('“quoted” — it’s fine…')).toBe('"quoted" - it\'s fine...');
  });

  it('keeps Latin-1 accents, which the standard fonts support', () => {
    expect(toStandardFontSafe('Zoë Müller')).toBe('Zoë Müller');
  });

  it('drops characters the standard fonts cannot encode', () => {
    expect(toStandardFontSafe('name 日本語')).toBe('name ');
  });
});

describe('wrap', () => {
  it('breaks text to fit the available width', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    const lines = wrap('The quick brown fox jumps over the lazy dog again and again', font, 11, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 11)).toBeLessThanOrEqual(120);
    }
  });

  it('breaks a single over-long token instead of overflowing', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    const url = 'https://example.com/a/very/long/path/that/will/never/fit/on/one/line/at/all';
    const lines = wrap(url, font, 11, 100);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 11)).toBeLessThanOrEqual(100);
    }
  });

  it('returns nothing for empty text', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    expect(wrap('   ', font, 11, 100)).toEqual([]);
  });
});
