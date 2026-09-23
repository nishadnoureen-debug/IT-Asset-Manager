import { Injectable } from '@nestjs/common';
import { label } from '@itam/shared';
import { BLANK, CompanyFormService, formDate } from '../pdf/company-form.service';
import { PrismaService } from '../prisma/prisma.service';

export const requestRef = (number: number) => `REQ-${String(number).padStart(6, '0')}`;

/**
 * The asset request form: what is being asked for, why, and signature boxes for the requester, the
 * approver and the person receiving the asset — printed for physical signatures.
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
        employee: { include: { department: true, location: true } },
        assetType: true,
        createdBy: { select: { displayName: true } },
        decisionBy: { select: { displayName: true } },
        fulfilledBy: { select: { displayName: true } },
        asset: { select: { assetTag: true, name: true } },
      },
    });
    const ref = requestRef(r.number);
    const decided = r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'FULFILLED';

    return this.forms.render(
      {
        title: 'ASSET REQUEST FORM',
        subtitle: `Ref. ${ref}   |   Date: ${formDate(r.createdAt) || BLANK}`,
        documentTitle: `ASSET REQUEST FORM ${ref}`,
      },
      (f) => {
        f.heading('Requested For');
        if (r.employee) {
          f.bullets([
            ['Employee Name', `${r.employee.firstName} ${r.employee.lastName}`.toUpperCase()],
            ['Employee ID', r.employee.employeeNumber],
            ['Designation', r.employee.jobTitle?.toUpperCase() ?? ''],
            ['Department', r.employee.department?.name ?? ''],
            ['Location', r.employee.location?.name ?? ''],
          ]);
        } else {
          f.bullets([
            ['Employee Name', ''],
            ['Employee ID', ''],
            ['Designation', ''],
            ['Department', ''],
          ]);
        }
        f.rule();

        f.heading('Request Details');
        f.bullets([
          ['Request', r.title],
          ['Request Type', label('requestType', r.type)],
          ['Item Requested', r.assetType?.name ?? ''],
          ['Quantity', String(r.quantity)],
          ['Priority', label('priority', r.priority)],
          ['Required By', formDate(r.neededBy)],
          ['Raised By', r.createdBy?.displayName ?? ''],
        ]);
        f.rule();

        f.heading('Justification');
        f.paragraph(r.justification);
        f.rule();

        f.heading('Approval');
        f.checkBoxes([
          { text: 'Approved', checked: r.status === 'APPROVED' || r.status === 'FULFILLED' },
          { text: 'Rejected', checked: r.status === 'REJECTED' },
          {
            text: 'Remarks',
            checked: Boolean(r.decisionNotes?.trim()),
            fill: r.decisionNotes?.trim() ?? '',
          },
        ]);
        f.doc.moveDown(0.4);
        f.fieldLine(
          'Requested By (name)',
          r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '',
        );
        f.signatureLine('Requested By (signature)');
        f.fieldLine('Approved By (name)', decided ? (r.decisionBy?.displayName ?? '') : '');
        f.signatureLine('Approved By (signature)');
        f.fieldLine('Approval Date', decided ? formDate(r.decisionAt) : '');
        if (r.status === 'FULFILLED') {
          f.rule();
          f.heading('Handover');
          f.bullets([
            ['Asset Issued', r.asset ? `${r.asset.assetTag} — ${r.asset.name}` : ''],
            ['Issued By', r.fulfilledBy?.displayName ?? ''],
            ['Issued On', formDate(r.fulfilledAt)],
          ]);
          f.signatureLine('Received By (signature)');
        }

        f.verifiedBy();
      },
    );
  }
}
