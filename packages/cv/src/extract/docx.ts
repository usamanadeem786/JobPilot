import mammoth from 'mammoth';

/**
 * Reads a DOCX as text, keeping the structure the CV parser depends on.
 *
 * Mammoth's `extractRawText` is the obvious call here and the wrong one: it
 * discards list formatting, so a bulleted achievement arrives as a bare line
 * indistinguishable from a job title. The parser uses exactly that distinction
 * to tell an achievement from the header of the next role, and without markers
 * it files bullets as employers — inventing companies out of the applicant's
 * own sentences.
 *
 * Converting to HTML first keeps `<li>` intact, so the markers can be put back
 * before the text reaches the parser.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return htmlToText(html);
}

/** Block-level tags whose boundaries are line breaks in the extracted text. */
const BLOCK_BOUNDARY = /<\/?(?:p|div|h[1-6]|tr|table|section|article|header|footer)\b[^>]*>/gi;

function htmlToText(html: string): string {
  const withMarkers = html
    // List items become bullet lines. The marker is what the parser reads.
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:ul|ol)>/gi, '\n')
    .replace(BLOCK_BOUNDARY, '\n')
    // Table cells sit side by side on one line, as they do on the page.
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(withMarkers)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
};

/**
 * Decodes entities once.
 *
 * Deliberately not repeated until stable: a CV that literally contains the
 * text "&amp;lt;" should keep it, and re-decoding would rewrite a person's own
 * words into markup.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const codePoint =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);

      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }

    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}
