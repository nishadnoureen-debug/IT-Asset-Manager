import { Injectable } from '@nestjs/common';
import type { AssetCondition } from '@prisma/client';
import { label } from '@itam/shared';
import { CompanyFormService, formDate } from '../pdf/company-form.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * The paper form for accessories handed straight to an employee, without a device: employee
 * details, what was issued under "Accessories Issued", the condition, the terms, a declaration to
 * sign and the "Approved by" boxes — the same sheet as the asset handover form.
 */
@Injectable()
export class AccessoryHandoverPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: CompanyFormService,
    private readonly settings: SettingsService,
  ) {}

  async render(assignmentId: string, signature?: Buffer): Promise<Buffer> {
    const a = await this.prisma.accessoryAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        accessory: { include: { location: true } },
        employee: true,
        assignedBy: { select: { displayName: true } },
        units: { select: { code: true, serialNumber: true }, orderBy: { number: 'asc' } },
      },
    });
    const settings = await this.settings.get();
    const ref = `ACH-${a.id.slice(0, 8).toUpperCase()}`;
    const pieces = a.units.map((u) => u.code).join(', ');

    return this.forms.render(
      {
        title: 'COMPANY ACCESSORIES HANDOVER FORM',
        subtitle: `Ref. ${ref}   |   Date: ${formDate(a.assignedAt)}`,
        documentTitle: `ACCESSORIES HANDOVER FORM ${ref}`,
      },
      (f) => {
        f.heading('Employee Details');
        f.bullets([
          ['Employee Name', `${a.employee.firstName} ${a.employee.lastName}`.toUpperCase()],
          ['Employee ID', a.employee.employeeNumber],
          ['Designation', a.employee.jobTitle?.toUpperCase() ?? ''],
          ['Nationality', a.employee.nationality?.toUpperCase() ?? ''],
        ]);
        f.rule();

        f.heading('Accessories Issued');
        f.bullets([
          ['Item', a.accessory.name],
          ['Category', label('accessoryCategory', a.accessory.category)],
          ['Stock Code', a.accessory.code],
          ['Quantity', String(a.quantity)],
          ...(pieces ? ([['Piece Codes', pieces]] as [string, string][]) : []),
          ...(a.accessory.brand || a.accessory.model
            ? ([
                ['Brand / Model', [a.accessory.brand, a.accessory.model].filter(Boolean).join(' ')],
              ] as [string, string][])
            : []),
          ['Issued From', a.accessory.location?.name ?? ''],
        ]);
        f.rule();

        f.heading('Condition at Time of Handover');
        f.checkBoxes(conditionRows(a.conditionAtAssignment, a.notes));
        f.rule();

        f.heading('Terms & Conditions');
        const terms = settings.formTerms
          .split('\n')
          .map((t) => t.trim().replaceAll('{company}', settings.companyName))
          .filter(Boolean);
        f.bullets(terms.map((t) => [null, t]));
        f.rule();

        f.heading('Declaration');
        f.paragraph(
          'I hereby acknowledge receipt of the above-mentioned company accessories. I agree to abide by the terms and conditions stated above.',
        );
        f.signatureLine('Employee Signature', signature);
        f.fieldLine('Date', formDate(a.assignedAt));
        if (a.assignedBy?.displayName) f.fieldLine('Issued By', a.assignedBy.displayName);

        f.approvedBy();
      },
    );
  }
}

/** The same five check boxes as the asset forms, with the recorded condition ticked. */
function conditionRows(condition: AssetCondition | null, remarks: string | null) {
  const damaged = condition === 'POOR' || condition === 'DAMAGED';
  return [
    { text: 'New', checked: condition === 'NEW' },
    { text: 'Good', checked: condition === 'GOOD' },
    { text: 'Used but Functional', checked: condition === 'FAIR' },
    {
      text: 'Minor Damage (Specify)',
      checked: damaged,
      fill: damaged ? label('assetCondition', condition) : '',
    },
    { text: 'Other Remarks', checked: Boolean(remarks?.trim()), fill: remarks?.trim() ?? '' },
  ];
}
