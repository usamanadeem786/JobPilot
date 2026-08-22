import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CvDocument } from '../schema';
import { layoutCv } from './layout';
import { getTemplate, type TemplateStyle } from './templates';
import type { RenderOptions } from './docx';

/**
 * PDF rendering.
 *
 * pdf-lib is pure JavaScript with no native bindings and no headless browser,
 * so this runs unchanged in a container and in a serverless function. The cost
 * is that there is no layout engine: line wrapping and page breaks are done
 * here, explicitly.
 *
 * Text is drawn as real text with the standard fonts, never as an image, so
 * the PDF remains selectable, searchable and extractable by an ATS.
 */

const A4 = { width: 595.28, height: 841.89 } as const;

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
}

interface Cursor {
  page: PDFPage;
  y: number;
}

export async function renderCvToPdf(cv: CvDocument, options: RenderOptions = {}): Promise<Buffer> {
  const template = getTemplate(options.templateKey);
  const pdf = await PDFDocument.create();

  pdf.setTitle(`${cv.personal.fullName} — CV`);
  pdf.setCreator('JobPilot');
  pdf.setProducer('JobPilot');

  const fonts = await loadFonts(pdf, template);
  const margin = template.marginPoints;
  const contentWidth = A4.width - margin * 2;

  const cursor: Cursor = {
    page: pdf.addPage([A4.width, A4.height]),
    y: A4.height - margin,
  };

  const accent = hexToRgb(template.accentColour);
  const muted = rgb(0.27, 0.27, 0.27);

  /** Starts a new page when the next block would not fit. */
  const ensureSpace = (needed: number): void => {
    if (cursor.y - needed >= margin) return;
    cursor.page = pdf.addPage([A4.width, A4.height]);
    cursor.y = A4.height - margin;
  };

  const drawLines = (
    lines: readonly string[],
    font: PDFFont,
    size: number,
    colour: ReturnType<typeof rgb>,
    indent = 0,
  ): void => {
    const lineHeight = size * template.lineSpacing;
    for (const line of lines) {
      ensureSpace(lineHeight);
      cursor.y -= lineHeight;
      cursor.page.drawText(line, { x: margin + indent, y: cursor.y, size, font, color: colour });
    }
  };

  for (const block of layoutCv(cv, template)) {
    switch (block.kind) {
      case 'name': {
        ensureSpace(template.nameFontSize * 1.4);
        cursor.y -= template.nameFontSize;
        cursor.page.drawText(block.text, {
          x: margin,
          y: cursor.y,
          size: template.nameFontSize,
          font: fonts.bold,
          color: accent,
        });
        cursor.y -= 4;
        break;
      }

      case 'contact': {
        const size = template.baseFontSize - 0.5;
        drawLines(wrap(block.parts.join('  |  '), fonts.regular, size, contentWidth), fonts.regular, size, muted);
        cursor.y -= template.sectionSpacing;
        break;
      }

      case 'heading': {
        const size = template.headingFontSize;
        ensureSpace(size * 2 + template.sectionSpacing);
        cursor.y -= template.sectionSpacing;
        cursor.y -= size;

        cursor.page.drawText(template.headingUppercase ? block.text.toUpperCase() : block.text, {
          x: margin,
          y: cursor.y,
          size,
          font: fonts.bold,
          color: accent,
        });

        if (template.headingRule) {
          cursor.y -= 3;
          cursor.page.drawLine({
            start: { x: margin, y: cursor.y },
            end: { x: margin + contentWidth, y: cursor.y },
            thickness: 0.6,
            color: accent,
          });
        }
        cursor.y -= 4;
        break;
      }

      case 'entry': {
        const size = template.baseFontSize + 0.5;
        ensureSpace(size * 2.4);
        cursor.y -= size * 1.2;

        cursor.page.drawText(block.primary, {
          x: margin,
          y: cursor.y,
          size,
          font: fonts.bold,
          color: rgb(0, 0, 0),
        });

        if (block.trailing) {
          // Right-aligned by measuring, since there are no tab stops in a PDF.
          const width = fonts.regular.widthOfTextAtSize(block.trailing, template.baseFontSize - 0.5);
          cursor.page.drawText(block.trailing, {
            x: margin + contentWidth - width,
            y: cursor.y,
            size: template.baseFontSize - 0.5,
            font: fonts.regular,
            color: muted,
          });
        }

        if (block.secondary) {
          const secondarySize = template.baseFontSize - 0.5;
          drawLines(
            wrap(block.secondary, fonts.italic, secondarySize, contentWidth),
            fonts.italic,
            secondarySize,
            muted,
          );
        }
        break;
      }

      case 'bullet': {
        const size = template.baseFontSize;
        const indent = 12;
        const lines = wrap(block.text, fonts.regular, size, contentWidth - indent);
        const lineHeight = size * template.lineSpacing;

        lines.forEach((line, index) => {
          ensureSpace(lineHeight);
          cursor.y -= lineHeight;
          if (index === 0) {
            cursor.page.drawText('•', { x: margin, y: cursor.y, size, font: fonts.regular, color: rgb(0, 0, 0) });
          }
          cursor.page.drawText(line, {
            x: margin + indent,
            y: cursor.y,
            size,
            font: fonts.regular,
            color: rgb(0, 0, 0),
          });
        });
        break;
      }

      case 'paragraph': {
        const size = template.baseFontSize;
        drawLines(wrap(block.text, fonts.regular, size, contentWidth), fonts.regular, size, rgb(0, 0, 0));
        cursor.y -= 2;
        break;
      }
    }
  }

  return Buffer.from(await pdf.save());
}

async function loadFonts(pdf: PDFDocument, template: TemplateStyle): Promise<Fonts> {
  const family =
    template.fontFamily === 'Times'
      ? [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic]
      : [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique];

  const [regular, bold, italic] = await Promise.all(family.map((font) => pdf.embedFont(font)));
  return { regular: regular as PDFFont, bold: bold as PDFFont, italic: italic as PDFFont };
}

/**
 * Greedy word wrapping against real glyph widths.
 *
 * A word longer than the line — a URL, usually — is broken by character
 * rather than allowed to run off the page, which is what a naive wrapper does.
 */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const sanitised = toStandardFontSafe(text);
  if (!sanitised) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of sanitised.split(/\s+/)) {
    if (!word) continue;

    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    // Break an over-long token so it cannot overflow the margin.
    let chunk = '';
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines;
}

/**
 * The standard PDF fonts are WinAnsi-encoded and throw on anything outside it.
 * Common typographic characters are folded to ASCII equivalents and anything
 * still unrepresentable is dropped, so an accented name or a smart quote can
 * never fail the whole render.
 */
export function toStandardFontSafe(text: string): string {
  const folded = text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•●▪‣]/g, '*')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/\t/g, '    ');

  // WinAnsi covers Latin-1 plus a handful of extras; drop the rest.
  return [...folded].filter((character) => character.codePointAt(0) !== undefined && character.codePointAt(0)! <= 0xff).join('');
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const value = hex.replace('#', '');
  const parse = (start: number): number => Number.parseInt(value.slice(start, start + 2), 16) / 255;
  return rgb(parse(0), parse(2), parse(4));
}
