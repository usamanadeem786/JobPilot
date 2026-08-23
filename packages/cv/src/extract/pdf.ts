import { getDocumentProxy } from 'unpdf';

/**
 * `unpdf` is a serverless-friendly build of pdf.js: pure JavaScript, no native
 * bindings and no filesystem access, so it runs unchanged in a Vercel function
 * and in a container. That rules out the usual pdf-parse deployment failures.
 *
 * Its `extractText` helper is deliberately not used. That helper joins every
 * text run with a space and returns the document as a single line, which is
 * fatal here: the section parser keys off line structure, so a CV extracted
 * that way yields no headings, no roles and no skills — the parse silently
 * produces an almost-empty document rather than failing loudly.
 *
 * A PDF has no notion of a line to begin with; it has glyphs at coordinates.
 * So the lines are reconstructed from the geometry, which is what any tool
 * that reads PDFs usefully ends up doing.
 */

/** Raised when the bytes are not a PDF that can be opened at all. */
export class CorruptDocumentError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super('That PDF could not be opened. It may be damaged or password-protected.');
    this.name = 'CorruptDocumentError';
    this.reason = reason;
  }
}

interface PositionedItem {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/**
 * Two text runs belong to the same line when their baselines are within this
 * many points. Subscripts, superscripts and inline font changes shift the
 * baseline slightly; a whole line step is several points more than this.
 */
const SAME_LINE_TOLERANCE = 2.5;

/**
 * A vertical gap larger than this multiple of the document's typical line step
 * is treated as a paragraph break. Blank lines help the parser separate one
 * role from the next when a CV uses spacing rather than bullets.
 */
const PARAGRAPH_GAP_RATIO = 1.6;

/**
 * A horizontal gap wider than this multiple of the preceding run's average
 * character width is a real space — usually a column gutter or a right-aligned
 * date. Without it, "Senior Engineer" and "March 2021" collide into one word.
 */
const SPACE_GAP_RATIO = 0.28;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    document = await getDocumentProxy(new Uint8Array(buffer));
  } catch (error) {
    // pdf.js throws a variety of types here (InvalidPDFException,
    // PasswordException, plain Error). They all mean the same thing to the
    // user, and none of them should reach them as a 500.
    throw new CorruptDocumentError(error instanceof Error ? error.message : 'unknown error');
  }

  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    try {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(linesFromItems(collectItems(content.items)));
    } catch {
      // One unreadable page should not lose the rest of the CV. A damaged
      // page contributes nothing rather than aborting the whole extraction.
      continue;
    }
  }

  return pages.filter((page) => page.trim().length > 0).join('\n\n');
}

/** Narrows pdf.js content items to the positioned text runs, dropping marks. */
function collectItems(items: readonly unknown[]): PositionedItem[] {
  const collected: PositionedItem[] = [];

  for (const item of items) {
    const candidate = item as { str?: unknown; width?: unknown; transform?: unknown };

    // Marked-content items have no `str` and carry no text.
    if (typeof candidate.str !== 'string' || candidate.str.length === 0) continue;

    const transform = candidate.transform;
    if (!Array.isArray(transform) || transform.length < 6) continue;

    const x = Number(transform[4]);
    const y = Number(transform[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    collected.push({
      text: candidate.str,
      x,
      y,
      width:
        typeof candidate.width === 'number' && Number.isFinite(candidate.width)
          ? candidate.width
          : 0,
    });
  }

  return collected;
}

/** Groups runs into lines by baseline, then orders each line left to right. */
function linesFromItems(items: PositionedItem[]): string {
  if (items.length === 0) return '';

  // Top of the page first. PDF y grows upwards, so this is descending.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: { y: number; items: PositionedItem[] }[] = [];

  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - item.y) <= SAME_LINE_TOLERANCE) {
      current.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  const step = typicalLineStep(lines.map((line) => line.y));
  const rendered: string[] = [];

  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (previous && step > 0 && previous.y - line.y > step * PARAGRAPH_GAP_RATIO) {
      rendered.push('');
    }
    rendered.push(joinLine(line.items));
  });

  return rendered.join('\n');
}

/**
 * The median gap between consecutive baselines.
 *
 * A median rather than a mean: a CV with one large heading or a photo would
 * drag a mean far enough to classify ordinary line breaks as paragraphs.
 */
function typicalLineStep(baselines: number[]): number {
  const gaps: number[] = [];
  for (let index = 1; index < baselines.length; index += 1) {
    const gap = (baselines[index - 1] as number) - (baselines[index] as number);
    if (gap > 0.5) gaps.push(gap);
  }

  if (gaps.length === 0) return 0;

  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] as number;
}

/** Joins one line's runs, inserting a space only where the layout had a gap. */
function joinLine(items: PositionedItem[]): string {
  const ordered = [...items].sort((a, b) => a.x - b.x);

  let line = '';
  let previousEnd: number | null = null;
  let previousCharWidth = 0;

  for (const item of ordered) {
    if (previousEnd !== null) {
      const gap = item.x - previousEnd;
      const threshold = Math.max(previousCharWidth * SPACE_GAP_RATIO, 0.5);
      const needsSpace = gap > threshold && !line.endsWith(' ') && !item.text.startsWith(' ');
      if (needsSpace) line += ' ';
    }

    line += item.text;
    previousEnd = item.x + item.width;
    previousCharWidth = item.text.length > 0 ? item.width / item.text.length : 0;
  }

  return line.trimEnd();
}
