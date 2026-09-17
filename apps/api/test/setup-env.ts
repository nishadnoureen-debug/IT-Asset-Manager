// Runs before test modules load: ConfigModule validates env when AppModule is imported.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://itam:itam@localhost:5432/itam_test';
process.env.ENABLE_SWAGGER = 'false';
process.env.ENABLE_SCHEDULER = 'false';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-that-is-long-enough-for-hs256-signing';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
