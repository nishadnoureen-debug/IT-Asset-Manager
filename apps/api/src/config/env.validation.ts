import { z } from 'zod';

const booleanString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

/** Treats blank values (e.g. an empty dashboard field) as "not set". */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z
      .string({ required_error: 'DATABASE_URL is required' })
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a PostgreSQL connection string'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Express "trust proxy" setting so req.ip reflects the client behind the Next.js proxy. */
    TRUST_PROXY: z.string().default('loopback'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(600),
    ENABLE_SWAGGER: booleanString('false'),
    ENABLE_SCHEDULER: booleanString('true'),

    // Authentication
    JWT_ACCESS_SECRET: z
      .string({ required_error: 'JWT_ACCESS_SECRET is required' })
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    /** 32-byte key, base64 — encrypts licence keys at rest (AES-256-GCM). */
    ENCRYPTION_KEY: z
      .string({ required_error: 'ENCRYPTION_KEY is required' })
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'ENCRYPTION_KEY must be 32 bytes, base64',
      ),

    /** Public URL of the web app — used in QR codes, reset links and PDFs. A bare host gets https://. */
    PUBLIC_WEB_URL: z.preprocess((value) => {
      const v = blankToUndefined(value);
      if (typeof v !== 'string') return v;
      const url = /^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`;
      return url.replace(/\/+$/, '');
    }, z.string().url('PUBLIC_WEB_URL must be a URL').default('http://localhost:3000')),
    /**
     * Owner of a new install. While the system has no active Super Admin, only this email can register
     * (becoming the Super Admin); registration then closes. Protects a public URL during first setup.
     */
    BOOTSTRAP_ADMIN_EMAIL: z.preprocess((value) => {
      const v = blankToUndefined(value);
      return typeof v === 'string' ? v.trim().toLowerCase() : v;
    }, z.string().email('BOOTSTRAP_ADMIN_EMAIL must be an email address').optional()),

    // File storage
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString('true'),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required for s3 storage',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule — fails fast at boot with every invalid variable listed. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
