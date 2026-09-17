import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

async function parse(query: Record<string, string>) {
  const dto = plainToInstance(PaginationQueryDto, query);
  return { dto, errors: await validate(dto) };
}

describe('PaginationQueryDto', () => {
  it('applies defaults', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: 20, sortOrder: 'desc' });
    expect(dto.skip).toBe(0);
  });

  it('coerces query strings and computes skip', async () => {
    const { dto, errors } = await parse({ page: '3', limit: '10' });
    expect(errors).toHaveLength(0);
    expect(dto.skip).toBe(20);
  });

  it('rejects oversize limits and unsafe sort fields', async () => {
    const { errors } = await parse({
      limit: '500',
      sortBy: 'name; DROP TABLE',
      sortOrder: 'sideways',
    });
    expect(errors.map((e) => e.property).sort()).toEqual(['limit', 'sortBy', 'sortOrder']);
  });
});
