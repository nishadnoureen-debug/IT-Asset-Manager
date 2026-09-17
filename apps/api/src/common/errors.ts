import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/** Domain error helpers — every error carries a stable machine-readable `code`. */
export const Errors = {
  notFound: (entity: string) =>
    new NotFoundException({ code: 'NOT_FOUND', message: `${entity} not found` }),
  conflict: (code: string, message: string, details?: unknown) =>
    new ConflictException({ code, message, details }),
  invalidState: (message: string, details?: unknown) =>
    new UnprocessableEntityException({ code: 'INVALID_STATE', message, details }),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new ForbiddenException({ code: 'FORBIDDEN', message }),
  badRequest: (message: string, field?: string) =>
    new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: field ? [{ field, errors: [message] }] : undefined,
    }),
};
