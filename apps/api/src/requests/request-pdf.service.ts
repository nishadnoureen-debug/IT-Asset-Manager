import { Injectable } from '@nestjs/common';
import type { RequestType } from '@prisma/client';
import { label } from '@itam/shared';
import type { CheckBoxRow } from '../pdf/company-form.service';
import {
  BLANK,
  CompanyFormService,
  formDate,
  REQUEST_FORM_SIGNATORIES,
} from '../pdf/company-form.service';
import { PrismaService } from '../prisma/prisma.service';

export const requestRef = (number: number) => `REQ-${String(number).padStart(6, '0')}`;

/** The check box each request type ticks, in the order they are printed. */
const TYPE_ROWS: { type: RequestType | 'OTHER'; text: string }[] = [
  { type: 'NEW_ASSET', text: 'New Requirement (Specify)' },
  { type: 'REPLACEMENT', text: 'Replacement (Old Asset Code)' },
  { type: 'UPGRADE', text: 'Upgrade (Specify)' },
  { type: 'TEMPORARY', text: 'Temporary Use (Return Date)' },
  { type: 'OTHER', text: 'Other Remarks' },
];

/**
 * The ASSET REQUEST FORM as agreed with the company: employee details, asset details, the request
 * type ticked, and the two approval boxes — printed for physical signatures. The layout is fixed, so
 * it takes nothing from Settings → Forms.
 */
@Injectable()
export class RequestPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: CompanyFormService,
  ) {}

  async render(requestId: string): Promise<Buffer> {
    const r = await this.prisma.assetRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        employee: { include: { department: true } },
        assetType: true,
        createdBy: { select: { displayName: true } },
      },
    });
    const ref = requestRef(r.number);
    const e = r.employee;

    return this.forms.render(
      {
        title: 'ASSET REQUEST FORM',
        subtitle: `Ref. ${ref}   |   Date: ${formDate(r.createdAt) || BLANK}`,
        documentTitle: `ASSET REQUEST FORM ${ref}`,
      },
      (f) => {
        f.heading('Employee Details');
        f.fields([
          ['Employee Name', e ? `${e.firstName} ${e.lastName}`.toUpperCase() : ''],
          ['Employee ID', e?.employeeNumber ?? ''],
          ['Designation', e?.jobTitle?.toUpperCase() ?? ''],
          ['Department', e?.department?.name ?? ''],
          ['Nationality', e?.nationality?.toUpperCase() ?? ''],
        ]);
        f.rule();

        f.heading('Asset Details');
        f.fields([
          ['Asset Type (Laptop / Mobile / Tablet / SIM / Other)', r.assetType?.name ?? r.title],
          ['Brand / Model Preferred', r.preferredModel ?? ''],
          ['Quantity', String(r.quantity)],
          ['Accessories Required', r.accessoriesRequired ?? ''],
          ['Required By (Date)', formDate(r.neededBy)],
          ['Purpose / Justification', r.justification],
        ]);
        f.rule();

        f.heading('Request Type');
        f.checkBoxes(this.typeRows(r.type, r.typeDetail));
        f.rule();

        // The decision is recorded in the system; on paper the form is simply countersigned.
        f.approvedBy(REQUEST_FORM_SIGNATORIES);
      },
    );
  }

  /** Ticks the row the request type belongs to and writes its detail on that line. */
  private typeRows(type: RequestType, detail: string | null): CheckBoxRow[] {
    const listed = TYPE_ROWS.some((row) => row.type === type);
    return TYPE_ROWS.map((row) => {
      const checked = row.type === type || (row.type === 'OTHER' && !listed);
      // A type without its own row (accessory, software, repair) is named on the "Other" line.
      const named = checked && !listed ? label('requestType', type) : '';
      const fill = [named, detail?.trim()].filter(Boolean).join(' - ');
      return { text: row.text, checked, fill: checked ? fill : '' };
    });
  }
}
