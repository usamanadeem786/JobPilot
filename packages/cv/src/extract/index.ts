import { detectCvType, isTypeMismatch, type SupportedCvType } from './detect';
import { extractDocxText } from './docx';
import { extractPdfText } from './pdf';

export * from './detect';

export interface ExtractionResult {
  readonly text: string;
  readonly detectedType: SupportedCvType;
  /** True when the declared MIME type did not match the actual bytes. */
  readonly declaredTypeMismatch: boolean;
  readonly characterCount: number;
}

export class UnsupportedFileTypeError extends Error {
  constructor() {
    super('Only PDF and DOCX files are supported.');
    this.name = 'UnsupportedFileTypeError';
  }
}

export class EmptyDocumentError extends Error {
  constructor() {
    super('No text could be read from that file. A scanned image needs OCR first.');
    this.name = 'EmptyDocumentError';
  }
}

/**
 * A CV with no extractable text is almost always a scan — a photo of a page in
 * a PDF wrapper. Failing with a message that says so is far more useful than
 * storing an empty document and letting tailoring produce nothing later.
 */
const MIN_USEFUL_CHARACTERS = 50;

export async function extractCvText(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<ExtractionResult> {
  const detectedType = detectCvType(buffer);
  if (!detectedType) throw new UnsupportedFileTypeError();

  const text = detectedType === 'pdf' ? await extractPdfText(buffer) : await extractDocxText(buffer);
  const normalised = normaliseWhitespace(text);

  if (normalised.replace(/\s/g, '').length < MIN_USEFUL_CHARACTERS) {
    throw new EmptyDocumentError();
  }

  return {
    text: normalised,
    detectedType,
    declaredTypeMismatch: isTypeMismatch(declaredMimeType, detectedType),
    characterCount: normalised.length,
  };
}

/**
 * PDF extraction produces ragged whitespace: non-breaking spaces, stray
 * carriage returns, and runs of blank lines where the layout had columns.
 * The section parser keys off line structure, so normalising here keeps that
 * logic from drowning in special cases.
 */
export function normaliseWhitespace(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // Non-breaking, narrow and figure spaces, plus zero-width marks,
      // appear wherever the original layout had kerning or a column
      // gutter. Written as escapes on purpose: an invisible character
      // inside a character class is unreadable in review and trivially
      // deleted by accident.
      .replace(/[\u00A0\u202F\u2007]/g, ' ')
      // Alternation rather than a character class: a class containing
      // the zero-width joiner is flagged as misleading, since ZWJ is
      // what binds emoji sequences together.
      .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
