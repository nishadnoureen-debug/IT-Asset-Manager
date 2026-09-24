import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { AppSettings } from '@itam/shared';
import { type Pdf, PdfService, pdfSafe } from './pdf.service';
import { SettingsService } from '../settings/settings.service';

/** Company letterhead and watermark printed on every form page (apps/api/assets/forms). */
const ASSETS_DIR = join(__dirname, '..', '..', 'assets', 'forms');
let branding: { letterhead: Buffer; watermark: Buffer } | null | undefined;
function loadBranding() {
  if (branding === undefined) {
    try {
      branding = {
        letterhead: readFileSync(join(ASSETS_DIR, 'letterhead.jpg')),
        watermark: readFileSync(join(ASSETS_DIR, 'watermark.jpg')),
      };
    } catch {
      branding = null; // Forms still render, just without the letterhead.
    }
  }
  return branding;
}

/**
 * Embeds an image once so every page can reuse it. PDFKit's `image()` accepts the returned object at
 * runtime; its type definitions only list buffers and paths, hence the cast.
 */
type ImageSource = Parameters<Pdf['image']>[0];
const embedImage = (doc: Pdf, src: Buffer): ImageSource =>
  (doc as unknown as { openImage(src: Buffer): ImageSource }).openImage(src);

export const FORM_COLORS = {
  heading: '#0F4761',
  text: '#000000',
  value: '#334155',
  rule: '#A0A0A0',
  line: '#6B7280',
};
const PAGE = { width: 595.28, height: 841.89 };
const MARGINS = { top: 122, bottom: 82, left: 56, right: 56 };
const CONTENT_WIDTH = PAGE.width - MARGINS.left - MARGINS.right;
/** Underscores where a value is missing, so it can be written in by hand. */
export const BLANK = '____________________';

export interface CheckBoxRow {
  text: string;
  checked: boolean;
  /** Written on the line after the label. */
  fill?: string;
}

/**
 * One printed company form: letterhead, blue section headings, bulleted details, check boxes,
 * signature lines and "Verified by" boxes. Layout follows the company's ASSET HANDOVER FORM.
 */
export class CompanyForm {
  constructor(
    readonly doc: Pdf,
    readonly settings: AppSettings,
    private readonly pdf: PdfService,
  ) {}

  title(text: string, subtitle: string): void {
    this.doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(FORM_COLORS.heading)
      .text(text, MARGINS.left, this.doc.y, {
        width: CONTENT_WIDTH,
        align: 'center',
        underline: true,
      });
    this.doc
      .moveDown(0.3)
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#64748B')
      .text(pdfSafe(subtitle), MARGINS.left, this.doc.y, { width: CONTENT_WIDTH, align: 'center' });
    this.doc.moveDown(0.6);
  }

  heading(text: string): void {
    this.pdf.ensureSpace(this.doc, 70);
    this.doc
      .moveDown(0.35)
      .font('Helvetica')
      .fontSize(13.5)
      .fillColor(FORM_COLORS.heading)
      .text(text, MARGINS.left, this.doc.y, { width: CONTENT_WIDTH });
    this.doc.moveDown(0.3);
  }

  /** Grey horizontal line between sections (as in the Word form). */
  rule(): void {
    this.pdf.ensureSpace(this.doc, 16);
    const y = this.doc.y + 6;
    this.doc
      .save()
      .lineWidth(1.5)
      .strokeColor(FORM_COLORS.rule)
      .moveTo(MARGINS.left, y)
      .lineTo(MARGINS.left + CONTENT_WIDTH, y)
      .stroke()
      .restore();
    this.doc.y = y + 8;
  }

  /** Bulleted "Label: value" lines; a null label prints the value as a plain bullet point. */
  bullets(rows: [string | null, string][]): void {
    const textX = MARGINS.left + 26;
    const width = CONTENT_WIDTH - 26;
    for (const [key, value] of rows) {
      const plain = pdfSafe(value).trim();
      this.doc.font('Times-Roman').fontSize(11);
      const height = this.doc.heightOfString(`${key ?? ''}: ${plain || BLANK}`, { width });
      this.pdf.ensureSpace(this.doc, height + 6);
      const y = this.doc.y;
      this.doc.fillColor(FORM_COLORS.text).text('•', MARGINS.left + 12, y, { lineBreak: false });
      if (key === null) {
        this.doc.fillColor(FORM_COLORS.text).text(plain, textX, y, { width });
      } else {
        this.doc
          .fillColor(FORM_COLORS.text)
          .text(`${key}: `, textX, y, { width, continued: true })
          .fillColor(FORM_COLORS.value)
          .text(plain || BLANK);
      }
      this.doc.moveDown(0.25);
    }
  }

  paragraph(text: string): void {
    this.doc.font('Times-Roman').fontSize(11);
    this.pdf.ensureSpace(this.doc, this.doc.heightOfString(text, { width: CONTENT_WIDTH }) + 8);
    this.doc.fillColor(FORM_COLORS.text).text(pdfSafe(text), MARGINS.left, this.doc.y, {
      width: CONTENT_WIDTH,
      align: 'justify',
    });
    this.doc.moveDown(0.6);
  }

  /** Tick boxes, one per line, each followed by a line to write on. */
  checkBoxes(rows: CheckBoxRow[]): void {
    for (const row of rows) {
      this.pdf.ensureSpace(this.doc, 22);
      const y = this.doc.y;
      const box = 9;
      const bx = MARGINS.left + 8;
      const by = y + 2;
      this.doc.save().lineWidth(0.8).strokeColor('#111827').rect(bx, by, box, box).stroke();
      if (row.checked) {
        this.doc
          .lineWidth(1.4)
          .moveTo(bx + 1.8, by + 4.8)
          .lineTo(bx + 3.8, by + 7.2)
          .lineTo(bx + 7.6, by + 1.8)
          .stroke();
      }
      this.doc.restore();
      const labelText = `${row.text}: `;
      this.doc.font('Times-Roman').fontSize(11).fillColor(FORM_COLORS.text);
      const labelX = bx + box + 7;
      this.doc.text(labelText, labelX, y, { lineBreak: false });
      const lineX = labelX + this.doc.widthOfString(labelText);
      const lineEnd = MARGINS.left + CONTENT_WIDTH;
      if (row.fill) {
        this.doc
          .fillColor(FORM_COLORS.value)
          .text(pdfSafe(row.fill), lineX + 2, y, { width: lineEnd - lineX - 2 });
      }
      const underlineY = Math.max(this.doc.y, y + 13);
      this.doc
        .save()
        .lineWidth(0.6)
        .strokeColor(FORM_COLORS.line)
        .moveTo(lineX, y + 13)
        .lineTo(lineEnd, y + 13)
        .stroke()
        .restore();
      this.doc.y = underlineY + 7;
    }
    this.doc.x = MARGINS.left;
  }

  /** "Label: ______" with the value written on the line. */
  fieldLine(labelText: string, value: string): void {
    this.pdf.ensureSpace(this.doc, 24);
    const y = this.doc.y;
    const text = `${labelText}: `;
    this.doc
      .font('Times-Roman')
      .fontSize(11)
      .fillColor(FORM_COLORS.text)
      .text(text, MARGINS.left, y, { lineBreak: false });
    const lineX = MARGINS.left + this.doc.widthOfString(text);
    const lineEnd = Math.min(lineX + 220, MARGINS.left + CONTENT_WIDTH);
    if (value)
      this.doc.fillColor(FORM_COLORS.value).text(pdfSafe(value), lineX + 4, y, {
        width: lineEnd - lineX - 4,
        lineBreak: false,
      });
    this.doc
      .save()
      .lineWidth(0.6)
      .strokeColor(FORM_COLORS.line)
      .moveTo(lineX, y + 13)
      .lineTo(lineEnd, y + 13)
      .stroke()
      .restore();
    this.doc.x = MARGINS.left;
    this.doc.y = y + 22;
  }

  /** Signature line with an electronically captured signature drawn on it, if there is one. */
  signatureLine(labelText: string, signature?: Buffer): void {
    this.pdf.ensureSpace(this.doc, 64);
    const top = this.doc.y;
    const lineY = top + (signature ? 44 : 22);
    const text = `${labelText}: `;
    this.doc.font('Times-Roman').fontSize(11).fillColor(FORM_COLORS.text);
    const lineX = MARGINS.left + this.doc.widthOfString(text);
    if (signature) this.doc.image(signature, lineX + 8, top, { fit: [180, 46] });
    this.doc.text(text, MARGINS.left, lineY - 12, { lineBreak: false });
    this.doc
      .save()
      .lineWidth(0.6)
      .strokeColor(FORM_COLORS.line)
      .moveTo(lineX, lineY + 1)
      .lineTo(lineX + 220, lineY + 1)
      .stroke()
      .restore();
    this.doc.x = MARGINS.left;
    this.doc.y = lineY + 10;
  }

  /** "Verified by:" boxes, three per row: title, name, and space to sign. */
  verifiedBy(): void {
    const people = this.settings.formSignatories.filter((s) => s.title.trim());
    if (!people.length) return;
    const rowHeights = [26, 24, 44];
    const tableHeight = rowHeights.reduce((sum, h) => sum + h, 0);
    // Keep the heading and every row of boxes on one page, so nobody signs a stray half-table.
    this.pdf.ensureSpace(this.doc, 40 + Math.ceil(people.length / 3) * (tableHeight + 12));
    this.doc
      .moveDown(0.6)
      .font('Times-Roman')
      .fontSize(14)
      .fillColor(FORM_COLORS.text)
      .text('Verified by:', MARGINS.left, this.doc.y);
    this.doc.moveDown(0.5);
    for (let start = 0; start < people.length; start += 3) {
      const group = people.slice(start, start + 3);
      this.pdf.ensureSpace(this.doc, tableHeight + 12);
      const top = this.doc.y;
      const colWidth = CONTENT_WIDTH / 3;
      // Only as many boxes as there are people, and a short last row is centred on the page.
      const rowLeft = MARGINS.left + (CONTENT_WIDTH - group.length * colWidth) / 2;
      this.doc.save().lineWidth(0.75).strokeColor('#000000');
      for (let col = 0; col < group.length; col++) {
        let y = top;
        for (const h of rowHeights) {
          this.doc.rect(rowLeft + col * colWidth, y, colWidth, h).stroke();
          y += h;
        }
      }
      this.doc.restore();
      group.forEach((person, col) => {
        const x = rowLeft + col * colWidth + 4;
        const width = colWidth - 8;
        this.doc
          .font('Times-Roman')
          .fontSize(10.5)
          .fillColor(FORM_COLORS.text)
          .text(pdfSafe(person.title.toUpperCase()), x, top + 8, {
            width,
            align: 'center',
            lineBreak: false,
            ellipsis: true,
          });
        if (person.name.trim()) {
          this.doc
            .font('Times-Bold')
            .fontSize(10.5)
            .fillColor(FORM_COLORS.value)
            .text(pdfSafe(person.name.toUpperCase()), x, top + rowHeights[0] + 7, {
              width,
              align: 'center',
              lineBreak: false,
              ellipsis: true,
            });
        }
      });
      this.doc.x = MARGINS.left;
      this.doc.y = top + tableHeight + 12;
    }
  }
}

/** Day/month/year in the server's time zone (set TZ, e.g. Asia/Dubai). */
export const formDate = (d: Date | null | undefined): string =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d)
    : '';

/** Builds the company's printed forms: handover, transfer, return and asset request. */
@Injectable()
export class CompanyFormService {
  constructor(
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {}

  async render(
    meta: { title: string; subtitle: string; documentTitle: string },
    build: (form: CompanyForm) => void,
  ): Promise<Buffer> {
    const settings = await this.settings.get();
    return this.pdf.render(
      (doc) => {
        // Opened once so every page references the same embedded images.
        const files = loadBranding();
        const images = files && {
          letterhead: embedImage(doc, files.letterhead),
          watermark: embedImage(doc, files.watermark),
        };
        const chrome = () => this.drawPageChrome(doc, settings.formFooter, images);
        chrome();
        doc.on('pageAdded', chrome);

        const form = new CompanyForm(doc, settings, this.pdf);
        form.title(meta.title, meta.subtitle);
        build(form);
      },
      {
        margins: MARGINS,
        info: { Title: meta.documentTitle, Author: settings.companyName },
      },
    );
  }

  /** Watermark, letterhead and footer. Drawn first on each page so content sits on top. */
  private drawPageChrome(
    doc: Pdf,
    footer: string,
    images: { letterhead: ImageSource; watermark: ImageSource } | null,
  ): void {
    const { x, y } = doc;
    if (images) {
      const wmWidth = 270;
      const wmHeight = (wmWidth * 356) / 541;
      doc.save().opacity(0.1);
      doc.image(images.watermark, (PAGE.width - wmWidth) / 2, (PAGE.height - wmHeight) / 2, {
        width: wmWidth,
      });
      doc.restore();
      const lhWidth = 470;
      doc.image(images.letterhead, (PAGE.width - lhWidth) / 2, 18, { width: lhWidth });
    }
    const lines = footer
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // write below the content area without starting a new page
    lines.forEach((line, i) => {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#1F2937')
        .text(pdfSafe(line), MARGINS.left, PAGE.height - 62 + i * 12, {
          width: CONTENT_WIDTH,
          align: 'center',
          lineBreak: false,
        });
    });
    doc.page.margins.bottom = bottom;
    doc.x = x;
    doc.y = y;
  }
}
