import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { AssetCondition } from '@prisma/client';
import { label, type FormSignatory } from '@itam/shared';
import { type Pdf, PdfService, pdfSafe } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type FormKind = 'HANDOVER' | 'TRANSFER' | 'RETURN';

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

const COLORS = { heading: '#0F4761', text: '#000000', value: '#334155', rule: '#A0A0A0' };
const PAGE = { width: 595.28, height: 841.89 };
const MARGINS = { top: 122, bottom: 82, left: 56, right: 56 };
const CONTENT_WIDTH = PAGE.width - MARGINS.left - MARGINS.right;
const BLANK = '____________________';

const TITLES: Record<FormKind, string> = {
  HANDOVER: 'COMPANY ASSETS HANDOVER FORM',
  TRANSFER: 'COMPANY ASSETS TRANSFER FORM',
  RETURN: 'COMPANY ASSETS RETURN FORM',
};

/** Day/month/year in the server's time zone (set TZ, e.g. Asia/Dubai). */
const fmtDate = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d)
    : '';

type PersonLike = {
  firstName: string;
  lastName: string;
  employeeNumber: string;
  jobTitle: string | null;
  nationality: string | null;
} | null;

/**
 * Handover, transfer and return forms in the company's paper format: letterhead, employee and device
 * details, condition check boxes, terms, declaration with the captured signature, and "Verified by"
 * signature boxes. Layout follows the company's ASSET HANDOVER FORM.
 */
@Injectable()
export class HandoverPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {}

  async render(
    assignmentId: string,
    kind: 'HANDOVER' | 'RETURN',
    signature?: Buffer,
  ): Promise<Buffer> {
    const a = await this.prisma.assetAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        asset: { include: { assetType: true } },
        employee: true,
        location: true,
        assignedBy: { select: { displayName: true } },
        returnedBy: { select: { displayName: true } },
        previousAssignment: { include: { employee: true, location: true } },
        accessoryAssignments: { include: { accessory: true } },
      },
    });
    const settings = await this.settings.get();
    const form: FormKind =
      kind === 'RETURN' ? 'RETURN' : a.previousAssignment ? 'TRANSFER' : 'HANDOVER';
    const date = form === 'RETURN' ? a.returnedAt : a.assignedAt;
    const ref = `${form === 'RETURN' ? 'RET' : form === 'TRANSFER' ? 'TRF' : 'HND'}-${a.id.slice(0, 8).toUpperCase()}`;

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

        this.title(doc, TITLES[form], `Ref. ${ref}   |   Date: ${fmtDate(date) || BLANK}`);

        if (form === 'TRANSFER') {
          this.heading(doc, 'Transferred From');
          this.personDetails(
            doc,
            a.previousAssignment!.employee,
            a.previousAssignment!.location?.name,
          );
          this.rule(doc);
          this.heading(doc, 'Transferred To');
        } else {
          this.heading(doc, 'Employee Details');
        }
        this.personDetails(doc, a.employee, a.location?.name);
        this.rule(doc);

        this.heading(doc, 'Device Details');
        const accessories = a.accessoryAssignments.map((acc) => {
          const qty = acc.quantity > 1 ? ` ×${acc.quantity}` : '';
          const status = form === 'RETURN' ? ` (${label('assignmentStatus', acc.status)})` : '';
          return `${acc.accessory.name}${qty}${status}`;
        });
        this.bullets(doc, [
          ['Device Type', a.asset.assetType.name],
          [
            'Brand / Model',
            [a.asset.brand, a.asset.model].filter(Boolean).join(' ') || a.asset.name,
          ],
          ['Inventory Code', a.asset.assetTag],
          ...(a.asset.serialNumber
            ? [['Serial Number', a.asset.serialNumber] as [string, string]]
            : []),
          ['Phone Number (if applicable)', a.asset.phoneNumber || 'N/A'],
          [
            form === 'RETURN' ? 'Accessories Returned' : 'Accessories Issued',
            accessories.join(', ') || 'None',
          ],
        ]);
        this.rule(doc);

        const condition = form === 'RETURN' ? a.conditionAtReturn : a.conditionAtAssignment;
        const remarks = form === 'RETURN' ? a.returnNotes : a.notes;
        this.heading(
          doc,
          `Condition at Time of ${form === 'RETURN' ? 'Return' : form === 'TRANSFER' ? 'Transfer' : 'Handover'}`,
        );
        this.conditionBoxes(doc, condition, remarks);
        this.rule(doc);

        if (form === 'TRANSFER') {
          this.heading(doc, 'Transfer Details');
          this.bullets(doc, [
            ['Transfer Date', fmtDate(a.assignedAt)],
            ['Reason for Transfer', a.transferReason ?? ''],
          ]);
          this.rule(doc);
        }

        if (form !== 'RETURN') {
          this.heading(doc, 'Terms & Conditions');
          const terms = settings.formTerms
            .split('\n')
            .map((t) => t.trim().replaceAll('{company}', settings.companyName))
            .filter(Boolean);
          this.bullets(
            doc,
            terms.map((t) => [null, t]),
          );
          this.rule(doc);
        }

        this.heading(doc, 'Declaration');
        this.paragraph(
          doc,
          form === 'RETURN'
            ? 'I hereby confirm that I have returned the above-mentioned company device(s) and accessories in the condition recorded on this form.'
            : `I hereby acknowledge receipt of the above-mentioned company device(s) and accessories${form === 'TRANSFER' ? ' transferred to me' : ''}. I agree to abide by the terms and conditions stated above.`,
        );
        this.signatureLine(doc, 'Employee Signature', signature);
        this.fieldLine(doc, 'Date', fmtDate(date));
        if (form === 'TRANSFER') {
          this.fieldLine(doc, 'Handed Over By (previous holder) Signature', '');
        }
        if (form === 'RETURN') {
          this.fieldLine(doc, 'Received By', a.returnedBy?.displayName ?? '');
        } else if (a.assignedBy?.displayName) {
          this.fieldLine(doc, 'Issued By', a.assignedBy.displayName);
        }

        this.verifiedBy(doc, settings.formSignatories);
      },
      {
        margins: MARGINS,
        info: { Title: `${TITLES[form]} ${a.asset.assetTag}`, Author: settings.companyName },
      },
    );
  }

  // ── Page furniture ───────────────────────────────────────────────────────────

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

  // ── Building blocks ──────────────────────────────────────────────────────────

  private title(doc: Pdf, text: string, subtitle: string): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(COLORS.heading)
      .text(text, MARGINS.left, doc.y, { width: CONTENT_WIDTH, align: 'center', underline: true });
    doc
      .moveDown(0.3)
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#64748B')
      .text(pdfSafe(subtitle), MARGINS.left, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.6);
  }

  private heading(doc: Pdf, text: string): void {
    this.pdf.ensureSpace(doc, 70);
    doc
      .moveDown(0.35)
      .font('Helvetica')
      .fontSize(13.5)
      .fillColor(COLORS.heading)
      .text(text, MARGINS.left, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.3);
  }

  /** Grey horizontal line between sections (as in the Word form). */
  private rule(doc: Pdf): void {
    this.pdf.ensureSpace(doc, 16);
    const y = doc.y + 6;
    doc
      .save()
      .lineWidth(1.5)
      .strokeColor(COLORS.rule)
      .moveTo(MARGINS.left, y)
      .lineTo(MARGINS.left + CONTENT_WIDTH, y)
      .stroke()
      .restore();
    doc.y = y + 8;
  }

  /** Bulleted "Label: value" lines; a null label prints the value as a plain bullet point. */
  private bullets(doc: Pdf, rows: [string | null, string][]): void {
    const textX = MARGINS.left + 26;
    const width = CONTENT_WIDTH - 26;
    for (const [key, value] of rows) {
      const plain = pdfSafe(value).trim();
      doc.font('Times-Roman').fontSize(11);
      const height = doc.heightOfString(`${key ?? ''}: ${plain || BLANK}`, { width });
      this.pdf.ensureSpace(doc, height + 6);
      const y = doc.y;
      doc.fillColor(COLORS.text).text('•', MARGINS.left + 12, y, { lineBreak: false });
      if (key === null) {
        doc.fillColor(COLORS.text).text(plain, textX, y, { width });
      } else {
        doc
          .fillColor(COLORS.text)
          .text(`${key}: `, textX, y, { width, continued: true })
          .fillColor(COLORS.value)
          .text(plain || BLANK);
      }
      doc.moveDown(0.25);
    }
  }

  private paragraph(doc: Pdf, text: string): void {
    doc.font('Times-Roman').fontSize(11);
    this.pdf.ensureSpace(doc, doc.heightOfString(text, { width: CONTENT_WIDTH }) + 8);
    doc.fillColor(COLORS.text).text(pdfSafe(text), MARGINS.left, doc.y, {
      width: CONTENT_WIDTH,
      align: 'justify',
    });
    doc.moveDown(0.6);
  }

  /** The Word form's five check boxes, with the recorded condition ticked. */
  private conditionBoxes(doc: Pdf, condition: AssetCondition | null, remarks: string | null): void {
    const damaged = condition === 'POOR' || condition === 'DAMAGED';
    const rows: { text: string; checked: boolean; fill: string }[] = [
      { text: 'New', checked: condition === 'NEW', fill: '' },
      { text: 'Good', checked: condition === 'GOOD', fill: '' },
      { text: 'Used but Functional', checked: condition === 'FAIR', fill: '' },
      {
        text: 'Minor Damage (Specify)',
        checked: damaged,
        fill: damaged ? label('assetCondition', condition) : '',
      },
      { text: 'Other Remarks', checked: Boolean(remarks?.trim()), fill: remarks?.trim() ?? '' },
    ];
    for (const row of rows) {
      this.pdf.ensureSpace(doc, 22);
      const y = doc.y;
      const box = 9;
      const bx = MARGINS.left + 8;
      const by = y + 2;
      doc.save().lineWidth(0.8).strokeColor('#111827').rect(bx, by, box, box).stroke();
      if (row.checked) {
        doc
          .lineWidth(1.4)
          .moveTo(bx + 1.8, by + 4.8)
          .lineTo(bx + 3.8, by + 7.2)
          .lineTo(bx + 7.6, by + 1.8)
          .stroke();
      }
      doc.restore();
      const labelText = `${row.text}: `;
      doc.font('Times-Roman').fontSize(11).fillColor(COLORS.text);
      const labelX = bx + box + 7;
      doc.text(labelText, labelX, y, { lineBreak: false });
      const lineX = labelX + doc.widthOfString(labelText);
      const lineEnd = MARGINS.left + CONTENT_WIDTH;
      if (row.fill) {
        doc
          .fillColor(COLORS.value)
          .text(pdfSafe(row.fill), lineX + 2, y, { width: lineEnd - lineX - 2 });
      }
      const underlineY = Math.max(doc.y, y + 13);
      doc
        .save()
        .lineWidth(0.6)
        .strokeColor('#6B7280')
        .moveTo(lineX, y + 13)
        .lineTo(lineEnd, y + 13)
        .stroke()
        .restore();
      doc.y = underlineY + 7;
    }
    doc.x = MARGINS.left;
  }

  /** "Label: ______" with the value written on the line. */
  private fieldLine(doc: Pdf, labelText: string, value: string): void {
    this.pdf.ensureSpace(doc, 24);
    const y = doc.y;
    const text = `${labelText}: `;
    doc.font('Times-Roman').fontSize(11).fillColor(COLORS.text).text(text, MARGINS.left, y, {
      lineBreak: false,
    });
    const lineX = MARGINS.left + doc.widthOfString(text);
    const lineEnd = Math.min(lineX + 220, MARGINS.left + CONTENT_WIDTH);
    if (value)
      doc.fillColor(COLORS.value).text(pdfSafe(value), lineX + 4, y, {
        width: lineEnd - lineX - 4,
        lineBreak: false,
      });
    doc
      .save()
      .lineWidth(0.6)
      .strokeColor('#6B7280')
      .moveTo(lineX, y + 13)
      .lineTo(lineEnd, y + 13)
      .stroke()
      .restore();
    doc.x = MARGINS.left;
    doc.y = y + 22;
  }

  /** Signature line with the electronically captured signature drawn on it, if there is one. */
  private signatureLine(doc: Pdf, labelText: string, signature?: Buffer): void {
    this.pdf.ensureSpace(doc, 64);
    const top = doc.y;
    const lineY = top + (signature ? 44 : 22);
    const text = `${labelText}: `;
    doc.font('Times-Roman').fontSize(11).fillColor(COLORS.text);
    const lineX = MARGINS.left + doc.widthOfString(text);
    if (signature) doc.image(signature, lineX + 8, top, { fit: [180, 46] });
    doc.text(text, MARGINS.left, lineY - 12, { lineBreak: false });
    doc
      .save()
      .lineWidth(0.6)
      .strokeColor('#6B7280')
      .moveTo(lineX, lineY + 1)
      .lineTo(lineX + 220, lineY + 1)
      .stroke()
      .restore();
    doc.x = MARGINS.left;
    doc.y = lineY + 10;
  }

  /** "Verified by:" boxes, three per row: title, name, and space to sign. */
  private verifiedBy(doc: Pdf, signatories: FormSignatory[]): void {
    const people = signatories.filter((s) => s.title.trim());
    if (!people.length) return;
    this.pdf.ensureSpace(doc, 130);
    doc
      .moveDown(0.6)
      .font('Times-Roman')
      .fontSize(14)
      .fillColor(COLORS.text)
      .text('Verified by:', MARGINS.left, doc.y);
    doc.moveDown(0.5);

    const rowHeights = [26, 24, 44];
    const tableHeight = rowHeights.reduce((sum, h) => sum + h, 0);
    for (let start = 0; start < people.length; start += 3) {
      const group = people.slice(start, start + 3);
      this.pdf.ensureSpace(doc, tableHeight + 12);
      const top = doc.y;
      const colWidth = CONTENT_WIDTH / 3;
      doc.save().lineWidth(0.75).strokeColor('#000000');
      for (let col = 0; col < 3; col++) {
        let y = top;
        for (const h of rowHeights) {
          doc.rect(MARGINS.left + col * colWidth, y, colWidth, h).stroke();
          y += h;
        }
      }
      doc.restore();
      group.forEach((person, col) => {
        const x = MARGINS.left + col * colWidth + 4;
        const width = colWidth - 8;
        doc
          .font('Times-Roman')
          .fontSize(10.5)
          .fillColor(COLORS.text)
          .text(pdfSafe(person.title.toUpperCase()), x, top + 8, {
            width,
            align: 'center',
            lineBreak: false,
            ellipsis: true,
          });
        if (person.name.trim()) {
          doc
            .font('Times-Bold')
            .fontSize(10.5)
            .fillColor(COLORS.value)
            .text(pdfSafe(person.name.toUpperCase()), x, top + rowHeights[0] + 7, {
              width,
              align: 'center',
              lineBreak: false,
              ellipsis: true,
            });
        }
      });
      doc.x = MARGINS.left;
      doc.y = top + tableHeight + 12;
    }
  }

  private personDetails(doc: Pdf, person: PersonLike, locationName?: string | null): void {
    if (!person) {
      this.bullets(doc, [['Location', locationName ?? '']]);
      return;
    }
    this.bullets(doc, [
      ['Employee Name', `${person.firstName} ${person.lastName}`.toUpperCase()],
      ['Employee ID', person.employeeNumber],
      ['Designation', person.jobTitle?.toUpperCase() ?? ''],
      ['Nationality', person.nationality?.toUpperCase() ?? ''],
    ]);
  }
}
