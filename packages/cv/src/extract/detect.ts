/**
 * File type detection by content, not by filename.
 *
 * An extension is attacker-controlled: `payload.exe` renamed to `cv.pdf`
 * still has an extension of `.pdf`. Sniffing the leading bytes is what
 * actually decides whether we hand the buffer to a PDF or DOCX parser, and
 * lets the upload endpoint reject anything else before it is stored.
 */

export const SUPPORTED_CV_TYPES = ['pdf', 'docx'] as const;
export type SupportedCvType = (typeof SUPPORTED_CV_TYPES)[number];

export const MIME_TYPES: Record<SupportedCvType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** `%PDF-` */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
/** `PK\x03\x04` — every OOXML file is a zip. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * A .docx is a zip containing `word/document.xml`. A .xlsx or .pptx has the
 * same zip signature, so the signature alone is not enough — the entry name
 * is what distinguishes them. Read from the raw bytes rather than unzipping,
 * which is enough to classify and avoids decompressing untrusted input here.
 */
function looksLikeDocx(buffer: Buffer): boolean {
  // Entry names are stored uncompressed in the local file headers, near the
  // start for a Word document.
  const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('latin1');
  return head.includes('word/');
}

export function detectCvType(buffer: Buffer): SupportedCvType | null {
  if (buffer.length < 4) return null;

  if (buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'pdf';

  if (buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC) && looksLikeDocx(buffer)) {
    return 'docx';
  }

  return null;
}

/**
 * True when the declared type and the actual bytes disagree — worth recording
 * on the audit trail even when the upload is otherwise accepted, because it is
 * either a broken client or someone probing.
 */
export function isTypeMismatch(declaredMimeType: string, detected: SupportedCvType | null): boolean {
  if (!detected) return false;
  return declaredMimeType !== MIME_TYPES[detected];
}
