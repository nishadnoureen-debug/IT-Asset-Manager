import { Injectable } from '@nestjs/common';
import type { Employee, SimSwapReason } from '@prisma/client';
import type { CheckBoxRow } from '../pdf/company-form.service';
import {
  BLANK,
  CompanyFormService,
  formDate,
  REQUEST_FORM_SIGNATORIES,
} from '../pdf/company-form.service';
import { PrismaService } from '../prisma/prisma.service';

export const swapRef = (number: number) => `SWP-${String(number).padStart(6, '0')}`;

/** The check box each reason ticks, in the order they are printed. */
const REASON_ROWS: { reason: SimSwapReason; text: string }[] = [
  { reason: 'LOW_USAGE', text: 'Low Usage (Specify)' },
  { reason: 'LOST', text: 'Lost SIM / Phone' },
  { reason: 'STOLEN', text: 'Stolen (Police Report No.)' },
  { reason: 'DAMAGED', text: 'Damaged / Faulty SIM' },
  { reason: 'UPGRADE', text: 'Upgrade to eSIM / New Device' },
  { reason: 'OTHER', text: 'Other Remarks' },
];

type Holder = Pick<
  Employee,
  'firstName' | 'lastName' | 'employeeNumber' | 'jobTitle' | 'nationality'
> & {
  department: { name: string } | null;
};

/**
 * The SIM CARD SWAP REQUEST FORM as agreed with the company: who handed the line over, who received
 * it, the SIM details, the reason ticked, and the two approval boxes. The layout is fixed, so it
 * takes nothing from Settings → Forms.
 */
@Injectable()
export class SimSwapPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: CompanyFormService,
  ) {}

  async render(swapId: string): Promise<Buffer> {
    const swap = await this.prisma.simSwap.findUniqueOrThrow({
      where: { id: swapId },
      include: {
        simCard: { include: { plan: true } },
        fromEmployee: { include: { department: true } },
        toEmployee: { include: { department: true } },
      },
    });
    const ref = swapRef(swap.number);

    return this.forms.render(
      {
        title: 'SIM CARD SWAP REQUEST FORM',
        subtitle: `Ref. ${ref}   |   Date: ${formDate(swap.swappedAt) || BLANK}`,
        documentTitle: `SIM CARD SWAP REQUEST FORM ${ref}`,
      },
      (f) => {
        f.heading('Employee Details');
        f.columns(
          { title: 'HANDED OVER BY (Current Holder)', rows: this.holder(swap.fromEmployee) },
          { title: 'RECEIVED BY (New Holder)', rows: this.holder(swap.toEmployee) },
        );
        f.rule();

        f.heading('SIM Details');
        f.fields([
          ['Mobile Number', swap.simCard.phoneNumber],
          ['Network Provider (e& / du)', swap.simCard.provider ?? ''],
          ['Plan / Package', swap.simCard.plan?.name ?? ''],
          ...(swap.newSimNumber
            ? ([['Replacement SIM (ICCID)', swap.newSimNumber]] as [string, string][])
            : []),
        ]);
        f.rule();

        f.heading('Reason for Swap');
        f.checkBoxes(this.reasonRows(swap.reason, swap.reasonDetail, swap.remarks));
        f.rule();

        f.approvedBy(REQUEST_FORM_SIGNATORIES);
      },
    );
  }

  /** The five employee lines of one column; blank lines when that side is the store. */
  private holder(employee: Holder | null): [string, string][] {
    return [
      ['Employee Name', employee ? `${employee.firstName} ${employee.lastName}`.toUpperCase() : ''],
      ['Employee ID', employee?.employeeNumber ?? ''],
      ['Designation', employee?.jobTitle?.toUpperCase() ?? ''],
      ['Department', employee?.department?.name ?? ''],
      ['Nationality', employee?.nationality?.toUpperCase() ?? ''],
    ];
  }

  /** Ticks the reason and writes its detail on that line; remarks always go on the last line. */
  private reasonRows(
    reason: SimSwapReason,
    detail: string | null,
    remarks: string | null,
  ): CheckBoxRow[] {
    return REASON_ROWS.map((row) => {
      const checked = row.reason === reason;
      const parts = [checked ? detail?.trim() : '', row.reason === 'OTHER' ? remarks?.trim() : ''];
      return { text: row.text, checked, fill: parts.filter(Boolean).join(' - ') };
    });
  }
}
