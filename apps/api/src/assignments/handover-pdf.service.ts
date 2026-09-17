import { Injectable } from '@nestjs/common';
import { label } from '@itam/shared';
import { PdfService, pdfSafe } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const fmtDate = (d: Date | null | undefined) =>
  d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';

/** Handover (assign/transfer) and return forms with the captured signature. */
@Injectable()
export class HandoverPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {}

  async render(assignmentId: string, kind: 'HANDOVER' | 'RETURN', signature?: Buffer): Promise<Buffer> {
    const a = await this.prisma.assetAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        asset: { include: { assetType: true } },
        employee: { include: { department: true, location: true } },
        location: true,
        assignedBy: { select: { displayName: true } },
        returnedBy: { select: { displayName: true } },
        previousAssignment: { include: { employee: true, location: true } },
        accessoryAssignments: { include: { accessory: true } },
      },
    });
    const { companyName } = await this.settings.get();
    const isReturn = kind === 'RETURN';
    const ref = `${isReturn ? 'RET' : 'HND'}-${a.id.slice(0, 8).toUpperCase()}`;

    return this.pdf.render((doc) => {
      this.pdf.header(
        doc,
        isReturn ? 'Asset Return Form' : 'Asset Handover Form',
        `${companyName} · Reference ${ref} · ${fmtDate(isReturn ? a.returnedAt : a.assignedAt)}`,
      );

      this.pdf.section(doc, 'Asset');
      this.pdf.keyValues(doc, [
        { label: 'Asset tag', value: a.asset.assetTag },
        { label: 'Name', value: a.asset.name },
        { label: 'Type', value: `${a.asset.assetType.name} (${label('assetCategory', a.asset.assetType.category)})` },
        { label: 'Brand / model', value: [a.asset.brand, a.asset.model].filter(Boolean).join(' ') },
        { label: 'Serial number', value: a.asset.serialNumber },
        {
          label: isReturn ? 'Condition at return' : 'Condition at hand-over',
          value: label('assetCondition', isReturn ? a.conditionAtReturn : a.conditionAtAssignment),
        },
      ]);

      this.pdf.section(doc, isReturn ? 'Returned by' : 'Assigned to');
      this.pdf.keyValues(doc, [
        { label: 'Employee', value: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : null },
        { label: 'Employee number', value: a.employee?.employeeNumber },
        { label: 'Department', value: a.employee?.department?.name },
        { label: 'Email', value: a.employee?.email },
        { label: 'Location', value: a.location?.name ?? a.employee?.location?.name },
        ...(isReturn ? [] : [{ label: 'Expected return', value: a.expectedReturnAt ? fmtDate(a.expectedReturnAt) : 'Not set' }]),
      ]);

      if (a.previousAssignment && !isReturn) {
        this.pdf.section(doc, 'Transfer');
        this.pdf.keyValues(doc, [
          {
            label: 'Transferred from',
            value: a.previousAssignment.employee
              ? `${a.previousAssignment.employee.firstName} ${a.previousAssignment.employee.lastName}`
              : a.previousAssignment.location?.name,
          },
          { label: 'Reason', value: a.transferReason },
        ]);
      }

      if (a.accessoryAssignments.length) {
        this.pdf.section(doc, 'Accessories');
        this.pdf.table(
          doc,
          [
            { label: 'Accessory', width: 0.5 },
            { label: 'Qty', width: 0.1 },
            { label: 'Status', width: 0.4 },
          ],
          a.accessoryAssignments.map((acc) => [
            acc.accessory.name,
            acc.quantity,
            isReturn ? `${label('assignmentStatus', acc.status)}${acc.notes ? ` — ${acc.notes}` : ''}` : 'Handed over',
          ]),
        );
      }

      const notes = isReturn ? a.returnNotes : a.notes;
      if (notes) {
        this.pdf.section(doc, 'Notes');
        doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(pdfSafe(notes));
      }

      this.pdf.section(doc, isReturn ? 'Confirmation' : 'Acknowledgement');
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#334155')
        .text(
          isReturn
            ? 'The asset and accessories listed above were returned in the condition recorded on this form.'
            : 'I confirm receipt of the asset and accessories listed above in the recorded condition. I agree to use them for business purposes, keep them secure, report loss or damage immediately, and return them on request or when leaving the company.',
        );
      doc.moveDown(1);

      this.pdf.ensureSpace(doc, 110);
      const y = doc.y;
      const left = doc.page.margins.left;
      if (signature) {
        doc.image(signature, left, y, { fit: [200, 70] });
      } else {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#94a3b8').text('Not signed electronically', left, y + 30);
      }
      doc.strokeColor('#94a3b8').moveTo(left, y + 76).lineTo(left + 220, y + 76).stroke();
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#475569')
        .text(
          `Signature${a.employee ? ` — ${pdfSafe(`${a.employee.firstName} ${a.employee.lastName}`)}` : ''}`,
          left,
          y + 80,
        );
      const staff = isReturn ? a.returnedBy?.displayName : a.assignedBy?.displayName;
      doc.text(`Processed by: ${pdfSafe(staff) || '—'}`, left + 280, y + 80);
      if (a.acknowledgedAt && !isReturn) doc.text(`Acknowledged: ${fmtDate(a.acknowledgedAt)}`, left + 280, y + 94);
    });
  }
}
