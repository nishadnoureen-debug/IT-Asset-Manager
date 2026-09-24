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
      },
    });
    const ref = requestRef(r.number);

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
          ['Item Requested', r.assetType?.name ?? ''],
          ['Request Type', label('requestType', r.type)],
          ['Quantity', String(r.quantity)],
          ['Priority', label('priority', r.priority)],
          ['Raised By', r.createdBy?.displayName ?? ''],
        ]);
        f.rule();

        f.heading('Justification');
        f.paragraph(r.justification);
        f.rule();

        // The decision is recorded in the system; on paper the form is simply countersigned.
        f.approvedBy();
      },
    );
  }
}
