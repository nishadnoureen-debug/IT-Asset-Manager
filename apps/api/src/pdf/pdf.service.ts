import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export type Pdf = PDFKit.PDFDocument;

export interface KeyValueRow {
  label: string;
  value: string | null | undefined;
}

@Injectable()
export class PdfService {
  /** Build a PDF in memory. */
  render(
    build: (doc: Pdf) => void | Promise<void>,
    options: PDFKit.PDFDocumentOptions = {},
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // PDFKit ignores `margins` whenever `margin` is set, so only default it when none are given.
      const doc = new PDFDocument({
        size: 'A4',
        bufferPages: true,
        ...(options.margins ? {} : { margin: 48 }),
        ...options,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      Promise.resolve(build(doc))
        .then(() => {
          this.addPageNumbers(doc);
          doc.end();
        })
        .catch(reject);
    });
  }

  header(doc: Pdf, title: string, subtitle?: string): void {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text(title);
    if (subtitle)
      doc.moveDown(0.2).font('Helvetica').fontSize(10).fillColor('#475569').text(subtitle);
    doc
      .moveDown(0.6)
      .strokeColor('#cbd5e1')
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke()
      .moveDown(0.8);
  }

  section(doc: Pdf, title: string): void {
    this.ensureSpace(doc, 60);
    doc
      .moveDown(0.4)
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#0f172a')
      .text(title)
      .moveDown(0.3);
  }

  keyValues(doc: Pdf, rows: KeyValueRow[]): void {
    const left = doc.page.margins.left;
    const labelWidth = 150;
    for (const row of rows) {
      this.ensureSpace(doc, 18);
      const y = doc.y;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#64748b')
        .text(row.label, left, y, { width: labelWidth });
      doc
        .font('Helvetica')
        .fillColor('#0f172a')
        .text(pdfSafe(row.value) || '—', left + labelWidth, y, {
          width: doc.page.width - doc.page.margins.right - left - labelWidth,
        });
      doc.moveDown(0.25);
    }
  }

  /** Simple table with fixed column widths (fractions of the printable width). */
  table(
    doc: Pdf,
    columns: { label: string; width: number }[],
    rows: (string | number | null | undefined)[][],
  ): void {
    const left = doc.page.margins.left;
    const printable = doc.page.width - left - doc.page.margins.right;
    const widths = columns.map((c) => c.width * printable);
    const drawRow = (cells: (string | number | null | undefined)[], bold: boolean) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8.5)
        .fillColor(bold ? '#0f172a' : '#1e293b');
      const heights = cells.map((cell, i) =>
        doc.heightOfString(pdfSafe(cell) || '—', { width: widths[i] - 6 }),
      );
      const height = Math.max(...heights, 10) + 6;
      this.ensureSpace(doc, height);
      const y = doc.y;
      if (bold)
        doc
          .rect(left, y - 2, printable, height)
          .fill('#f1f5f9')
          .fillColor('#0f172a');
      let x = left;
      cells.forEach((cell, i) => {
        doc.text(pdfSafe(cell) || '—', x + 3, y + 1, { width: widths[i] - 6 });
        x += widths[i];
      });
      doc.y = y + height;
      doc
        .strokeColor('#e2e8f0')
        .moveTo(left, doc.y - 2)
        .lineTo(left + printable, doc.y - 2)
        .stroke();
    };
    drawRow(
      columns.map((c) => c.label),
      true,
    );
    for (const row of rows) drawRow(row, false);
    doc.x = left;
  }

  ensureSpace(doc: Pdf, height: number): void {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
  }

  private addPageNumbers(doc: Pdf): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#94a3b8')
        .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 30, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: 'right',
        });
      doc.page.margins.bottom = bottom;
    }
  }
}

/**
 * The built-in PDF fonts only cover Windows-1252. Replace characters outside it so exports never fail
 * (full Unicode output needs an embedded font — see docs).
 */
export function pdfSafe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[^ -~ -ÿ\n–—‘’“”•€]/g, '?');
}
