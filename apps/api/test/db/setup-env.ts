import { testDatabaseUrl } from './test-database-url';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.ENABLE_SCHEDULER = 'false';
process.env.ENABLE_SWAGGER = 'false';
process.env.LOG_LEVEL = 'error';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.STORAGE_LOCAL_DIR ??= require('node:path').join(require('node:os').tmpdir(), 'itam-test-storage');
