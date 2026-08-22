/**
 * HTML to plain text.
 *
 * Order matters here, and getting it wrong is not obvious from a unit test
 * written against clean input. Greenhouse returns descriptions that are
 * HTML-ESCAPED — `&lt;div&gt;` rather than `<div>` — so a pipeline that strips
 * tags first and decodes entities afterwards produces literal markup in the
 * output: the strip pass sees no tags, then the decode pass creates them.
 *
 * Entities are therefore decoded first, tags stripped second, and entities
 * decoded once more for anything that was encoded inside the markup.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  bull: '*',
  middot: '*',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  // Control characters in scraped text are noise at best; at worst they are
  // the invisible-character tricks that make two identical-looking strings
  // compare unequal.
  if (!Number.isFinite(code) || code < 32 || (code >= 127 && code <= 159)) return ' ';
  try {
    return String.fromCodePoint(code);
  } catch {
    return ' ';
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|li|tr|section|article)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

/**
 * Cap on decode-and-strip rounds.
 *
 * Two covers everything seen in the wild — plain HTML, and Greenhouse's
 * escaped HTML. A third guards against content escaped twice over without
 * letting a hostile input spin here indefinitely.
 */
const MAX_DECODE_ROUNDS = 3;

export function htmlToText(html: string): string {
  let text = html;

  // Decode then strip, repeatedly, until the text stops changing. One pass in
  // either order is not enough: strip-then-decode turns `&lt;div&gt;` into a
  // literal `<div>` (which is what appeared in the job detail panel), and
  // decode-then-strip alone leaves double-escaped markup behind.
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    const next = stripTags(decodeEntities(text));
    if (next === text) break;
    text = next;
  }

  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
