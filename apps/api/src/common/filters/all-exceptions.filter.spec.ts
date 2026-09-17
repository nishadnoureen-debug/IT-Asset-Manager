import { ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHost(req: Record<string, unknown> = { url: '/api/v1/x', id: 'req-1' }) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  it('formats HttpException with default code', () => {
    const { host, status, json } = createHost();
    filter.catch(new NotFoundException('Asset not found'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0]).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Asset not found',
        requestId: 'req-1',
        path: '/api/v1/x',
      },
    });
  });

  it('keeps custom code and details', () => {
    const { host, status, json } = createHost();
    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'a' }],
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'a' }],
    });
  });

  it('maps Prisma unique violations to 409', () => {
    const { host, status, json } = createHost();
    const err = Object.assign(new Error('unique'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['serialNumber'] },
    });
    filter.catch(err, host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0][0].error).toMatchObject({
      code: 'CONFLICT',
      details: { fields: ['serialNumber'] },
    });
  });

  it('hides internal error messages', () => {
    const { host, status, json } = createHost();
    filter.catch(new Error('password=secret leaked'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].error.message).toBe('An unexpected error occurred');
  });
});
