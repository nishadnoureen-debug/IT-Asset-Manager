import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  };

  it('applies defaults and parses values', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGINS: 'http://a.test, http://b.test',
      PORT: '5000',
    });
    expect(env.PORT).toBe(5000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.ENABLE_SWAGGER).toBe(false);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.STORAGE_DRIVER).toBe('local');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/PostgreSQL/);
  });

  it('rejects an invalid port', () => {
    expect(() => validateEnv({ ...base, PORT: '99999' })).toThrow(/PORT/);
  });

  it('rejects weak JWT secrets and malformed encryption keys', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, ENCRYPTION_KEY: 'abc' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('requires a bucket for s3 storage', () => {
    expect(() => validateEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });
});
