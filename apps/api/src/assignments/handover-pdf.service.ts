import { Injectable } from '@nestjs/common';
import type { AssetCondition } from '@prisma/client';
import { label } from '@itam/shared';
import { BLANK, CompanyForm, CompanyFormService, formDate } from '../pdf/company-form.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type FormKind = 'HANDOVER' | 'TRANSFER' | 'RETURN';

const TITLES: Record<FormKind, string> = {
  HANDOVER: 'COMPANY ASSETS HANDOVER FORM',
  TRANSFER: 'COMPANY ASSETS TRANSFER FORM',
  RETURN: 'COMPANY ASSETS RETURN FORM',
};

type PersonLike = {
  firstName: string;
  lastName: string;
  employeeNumber: string;
  jobTitle: string | null;
  nationality: string | null;
} | null;

/**
 * Handover, transfer and return forms in the company's paper format: employee and device details,
 * condition check boxes, terms, declaration with the captured signature, and "Verified by" boxes.
 */
@Injectable()
export class HandoverPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: CompanyFormService,
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

    return this.forms.render(
      {
        title: TITLES[form],
        subtitle: `Ref. ${ref}   |   Date: ${formDate(date) || BLANK}`,
        documentTitle: `${TITLES[form]} ${a.asset.assetTag}`,
      },
      (f) => {
        if (form === 'TRANSFER') {
          f.heading('Transferred From');
          this.personDetails(
            f,
            a.previousAssignment!.employee,
            a.previousAssignment!.location?.name,
          );
          f.rule();
          f.heading('Transferred To');
        } else {
          f.heading('Employee Details');
        }
        this.personDetails(f, a.employee, a.location?.name);
        f.rule();

        f.heading('Device Details');
        const accessories = a.accessoryAssignments.map((acc) => {
          const qty = acc.quantity > 1 ? ` ×${acc.quantity}` : '';
          const status = form === 'RETURN' ? ` (${label('assignmentStatus', acc.status)})` : '';
          return `${acc.accessory.name}${qty}${status}`;
        });
        f.bullets([
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
        f.rule();

        const condition = form === 'RETURN' ? a.conditionAtReturn : a.conditionAtAssignment;
        const remarks = form === 'RETURN' ? a.returnNotes : a.notes;
        f.heading(
          `Condition at Time of ${form === 'RETURN' ? 'Return' : form === 'TRANSFER' ? 'Transfer' : 'Handover'}`,
        );
        f.checkBoxes(conditionRows(condition, remarks));
        f.rule();

        if (form === 'TRANSFER') {
          f.heading('Transfer Details');
          f.bullets([
            ['Transfer Date', formDate(a.assignedAt)],
            ['Reason for Transfer', a.transferReason ?? ''],
          ]);
          f.rule();
        }

        if (form !== 'RETURN') {
          f.heading('Terms & Conditions');
          const terms = settings.formTerms
            .split('\n')
            .map((t) => t.trim().replaceAll('{company}', settings.companyName))
            .filter(Boolean);
          f.bullets(terms.map((t) => [null, t]));
          f.rule();
        }

        f.heading('Declaration');
        f.paragraph(
          form === 'RETURN'
            ? 'I hereby confirm that I have returned the above-mentioned company device(s) and accessories in the condition recorded on this form.'
            : `I hereby acknowledge receipt of the above-mentioned company device(s) and accessories${form === 'TRANSFER' ? ' transferred to me' : ''}. I agree to abide by the terms and conditions stated above.`,
        );
        f.signatureLine('Employee Signature', signature);
        f.fieldLine('Date', formDate(date));
        if (form === 'TRANSFER') {
          f.fieldLine('Handed Over By (previous holder) Signature', '');
        }
        if (form === 'RETURN') {
          f.fieldLine('Received By', a.returnedBy?.displayName ?? '');
        } else if (a.assignedBy?.displayName) {
          f.fieldLine('Issued By', a.assignedBy.displayName);
        }

        f.verifiedBy();
      },
    );
  }

  private personDetails(f: CompanyForm, person: PersonLike, locationName?: string | null): void {
    if (!person) {
      f.bullets([['Location', locationName ?? '']]);
      return;
    }
    f.bullets([
      ['Employee Name', `${person.firstName} ${person.lastName}`.toUpperCase()],
      ['Employee ID', person.employeeNumber],
      ['Designation', person.jobTitle?.toUpperCase() ?? ''],
      ['Nationality', person.nationality?.toUpperCase() ?? ''],
    ]);
  }
}

/** The Word form's five check boxes, with the recorded condition ticked. */
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
