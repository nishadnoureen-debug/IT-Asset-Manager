import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

export interface FieldError {
  field: string;
  errors: string[];
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own: FieldError[] = error.constraints
      ? [{ field, errors: Object.values(error.constraints) }]
      : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/** Global DTO validation: strips/rejects unknown fields and transforms primitives. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: flattenValidationErrors(errors),
      }),
  });
}
