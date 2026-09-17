/**
 * Database used by `npm run test:db`. Never point this at a database with real data:
 * tests TRUNCATE every table.
 */
export function testDatabaseUrl(): string {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://itam:itam@localhost:5433/itam_test?schema=public';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run DB tests against "${dbName}": database name must contain "test".`,
    );
  }
  return url;
}
