import { extractText, getDocumentProxy } from 'unpdf';

/**
 * `unpdf` is a serverless-friendly build of pdf.js: pure JavaScript, no native
 * bindings and no filesystem access, so it runs unchanged in a Vercel function
 * and in a container. That rules out the usual pdf-parse deployment failures.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const document = await getDocumentProxy(new Uint8Array(buffer));
  // `mergePages` returns the document as a single string. Without it the
  // result is one entry per page, and a role's bullets get split at the seam.
  const { text } = await extractText(document, { mergePages: true });
  return text;
}
