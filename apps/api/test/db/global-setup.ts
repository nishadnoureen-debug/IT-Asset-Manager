import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { testDatabaseUrl } from './test-database-url';

/** Apply all migrations to the test database once before the suite. */
export default function globalSetup(): void {
  const url = testDatabaseUrl();
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
