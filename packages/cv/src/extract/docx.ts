import mammoth from 'mammoth';

/**
 * Mammoth maps Word styles to semantic output rather than dumping the XML, so
 * headings and list items survive as structure. Raw text is what the parser
 * consumes; the list markers matter because bullet points are how CV
 * achievements are written.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}
