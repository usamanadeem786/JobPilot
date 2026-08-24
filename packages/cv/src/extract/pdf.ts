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

/**
 * A gap this many times the character width is a word break rather than
 * letter spacing. Only used to mark the boundary so it survives assembly.
 */
const WORD_GAP_RATIO = 1.2;

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

/**
 * Reads a page, one column at a time.
 *
 * Grouping purely by baseline is correct for a single column and wrong for
 * everything else. A two-column CV puts "WORK EXPERIENCE" and "TECHNICAL
 * SKILLS" at the same height, so a naive read emits them as one line and
 * splices the sidebar into the body — every heading collides, and the parser
 * finds no experience at all in a CV that plainly has some. Two-column
 * templates are extremely common, so this is the normal case, not an edge one.
 */
function linesFromItems(items: PositionedItem[]): string {
  if (items.length === 0) return '';

  const columns = splitIntoColumns(items);
  return columns.map((column) => linesFromColumn(column)).join('\n\n');
}

/**
 * The x positions where the page is split into columns.
 *
 * A gutter is a vertical band that no text crosses. Finding one is not enough
 * on its own: a single-column CV with right-aligned dates also has whitespace
 * down the middle of some lines. What distinguishes a real column is that
 * *nothing at all* spans the gap and both sides carry a substantial share of
 * the text — so the merged occupied intervals, not the gaps in any one line,
 * are what decide it.
 */
const MIN_GUTTER_POINTS = 18;
const MIN_COLUMN_SHARE = 0.15;
const MIN_ITEMS_TO_DETECT_COLUMNS = 8;

/**
 * A real column occupies many lines of its own and carries a real share of the
 * words. These two guards are what separate a sidebar from right-aligned
 * dates, and they are needed because the obvious signals do not work:
 *
 *  - Item count alone is too weak. A one-column CV with a right-aligned date
 *    on every role can easily put a fifth of its runs on the right.
 *  - "Do the two sides share baselines?" sounds decisive and is not. A
 *    sidebar's rows line up with the body's rows often enough - that is
 *    exactly why the spliced output looked plausible in the first place.
 *
 * What genuinely differs is substance. A date column is a handful of short
 * strings on lines that belong to the left; a sidebar is many lines and a
 * meaningful fraction of the text.
 */
const MIN_COLUMN_LINES = 4;
const MIN_COLUMN_TEXT_SHARE = 0.15;

function splitIntoColumns(items: PositionedItem[]): PositionedItem[][] {
  if (items.length < MIN_ITEMS_TO_DETECT_COLUMNS) return [items];

  const spans = items
    .map((item) => [item.x, item.x + Math.max(item.width, 1)] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }

  if (merged.length < 2) return [items];

  const boundaries: number[] = [];
  for (let index = 0; index < merged.length - 1; index += 1) {
    const gapStart = (merged[index] as [number, number])[1];
    const gapEnd = (merged[index + 1] as [number, number])[0];
    if (gapEnd - gapStart >= MIN_GUTTER_POINTS) boundaries.push((gapStart + gapEnd) / 2);
  }

  if (boundaries.length === 0) return [items];

  const bands = partitionByBoundaries(items, boundaries);

  // Every band has to be substantial. A narrow strip of page furniture — a
  // rotated label, a margin note — is not a column, and treating it as one
  // would reorder the document around it.
  const threshold = items.length * MIN_COLUMN_SHARE;
  if (bands.length < 2 || bands.some((band) => band.length < threshold)) return [items];

  const totalCharacters = items.reduce((sum, item) => sum + item.text.trim().length, 0);

  for (const band of bands) {
    if (distinctBaselines(band) < MIN_COLUMN_LINES) return [items];

    const characters = band.reduce((sum, item) => sum + item.text.trim().length, 0);
    if (totalCharacters > 0 && characters / totalCharacters < MIN_COLUMN_TEXT_SHARE) {
      return [items];
    }
  }

  return bands;
}

/** How many separate lines a band occupies, at the line-grouping tolerance. */
function distinctBaselines(items: readonly PositionedItem[]): number {
  const baselines: number[] = [];

  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const last = baselines[baselines.length - 1];
    if (last === undefined || Math.abs(last - item.y) > SAME_LINE_TOLERANCE) {
      baselines.push(item.y);
    }
  }

  return baselines.length;
}

function partitionByBoundaries(
  items: PositionedItem[],
  boundaries: number[],
): PositionedItem[][] {
  const bands: PositionedItem[][] = Array.from({ length: boundaries.length + 1 }, () => []);

  for (const item of items) {
    let band = 0;
    while (band < boundaries.length && item.x >= (boundaries[band] as number)) band += 1;
    (bands[band] as PositionedItem[]).push(item);
  }

  // Left to right, which is reading order for every CV template in use.
  return bands.filter((band) => band.length > 0);
}

/** Groups one column's runs into lines by baseline, left to right. */
function linesFromColumn(items: PositionedItem[]): string {
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
    // pdf.js emits an inter-word space in a letter-spaced heading as a run of
    // its own, containing nothing but a space. That lone run is the only
    // surviving record of where one word ends and the next begins, so it is
    // marked with a double space and the boundary reaches the repair below.
    // Normalisation collapses it again afterwards.
    if (item.text.trim().length === 0) {
      if (!line.endsWith('  ')) line += line.endsWith(' ') ? ' ' : '  ';
      previousEnd = item.x + item.width;
      continue;
    }

    if (previousEnd !== null) {
      const gap = item.x - previousEnd;
      const threshold = Math.max(previousCharWidth * SPACE_GAP_RATIO, 0.5);
      const needsSpace = gap > threshold && !line.endsWith(' ') && !item.text.startsWith(' ');
      if (needsSpace) {
        // A markedly wider gap gets two spaces. In a letter-spaced heading
        // every glyph is its own run, so the space between letters and the
        // space between words would otherwise be identical by the time the
        // string is assembled - and the word boundary would be unrecoverable.
        // The extra space is collapsed again during normalisation.
        line += gap > Math.max(previousCharWidth * WORD_GAP_RATIO, threshold * 3) ? '  ' : ' ';
      }
    }

    line += item.text;
    previousEnd = item.x + item.width;
    previousCharWidth = item.text.length > 0 ? item.width / item.text.length : 0;
  }

  return collapseLetterSpacing(line.trimEnd());
}

/**
 * Repairs a line typeset with letter spacing.
 *
 * Designers track out headings, and the PDF then holds each glyph at its own
 * position with a real gap between them. Faithfully reproduced that becomes
 * "S o f t w a r e E n g i n e e r", which is what the user's job title looked
 * like after extraction - unusable as a headline and unmatchable as a heading.
 *
 * Only lines that are overwhelmingly single characters are touched, so ordinary
 * prose containing "a" or "I" is left exactly as written.
 */
function collapseLetterSpacing(line: string): string {
  const tokens = line.split(' ').filter((token) => token.length > 0);
  if (tokens.length < 6) return line;

  const singles = tokens.filter((token) => token.length === 1).length;
  if (singles / tokens.length < 0.75) return line;

  // Wide gaps are the word boundaries; single gaps are the letter spacing.
  // Splitting on the wide ones first is what keeps "Software Engineer" from
  // collapsing into "SoftwareEngineer".
  return line
    .trim()
    .split(/\s{2,}/)
    .map((word) => word.replace(/\s+/g, ''))
    .filter(Boolean)
    .join(' ');
}
