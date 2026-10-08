import { PrismaClient } from '@prisma/client';

/**
 * Clear the records a trial run leaves behind, keeping the people and the setup.
 *
 *   npm run db:clear                 # says what it would delete, deletes nothing
 *   npm run db:clear -- --yes        # deletes
 *
 * Point DATABASE_URL at the database you mean. This cannot be undone: take a backup
 * (`pg_dump`, or a Neon branch) before running it against anything you care about.
 *
 * Employees stay, with the departments, locations and managers that make an employee record
 * complete. Sign-ins, roles, permissions, Settings and the asset-type list stay too, so the app
 * still works the moment it is empty.
 */

/** Everything a trial leaves behind: devices, hand-outs, forms, trails. */
const CLEAR = [
  'asset_assignments',
  'asset_history',
  'assets',
  'accessory_assignments',
  'accessory_units',
  'accessories',
  'maintenance',
  'software_assignments',
  'software_licenses',
  'software',
  'asset_requests',
  'audit_items',
  'audit_sessions',
  'documents',
  'stored_files',
  'sim_swaps',
  'sim_usages',
  'sim_cards',
  'sim_plans',
  'rentals',
  'rental_items',
  'camps',
  'purchases',
  'vendors',
  'notifications',
  'activity_logs',
] as const;

/** The people, the sign-ins and the setup — what the app needs to be usable on day one. */
const KEEP = [
  'employees',
  'departments',
  'locations',
  'users',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'refresh_tokens',
  'password_reset_tokens',
  'asset_types',
  'settings',
  '_prisma_migrations',
] as const;

/** Codes start from 001 again, so the first real asset is AST-001. */
const SEQUENCES = ['asset_tag_seq', 'accessory_code_seq'] as const;

export interface ClearPlan {
  counts: Record<string, number>;
  kept: Record<string, number>;
  total: number;
  sql: string;
}

async function countRows(prisma: PrismaClient, tables: readonly string[]) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "public"."${table}"`,
    );
    counts[table] = Number(row.count);
  }
  return counts;
}

/**
 * What a clear would remove and what it would leave. Reading the table list from the database
 * rather than from this file means a table added later cannot be quietly skipped.
 */
export async function planClear(prisma: PrismaClient): Promise<ClearPlan> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const unknown = rows
    .map((r) => r.tablename)
    .filter((t) => !CLEAR.includes(t as never) && !KEEP.includes(t as never));
  if (unknown.length)
    throw new Error(
      `clear-data does not know whether to clear or keep: ${unknown.join(', ')}. ` +
        'Add each one to CLEAR or KEEP in apps/api/src/database/clear-data.ts.',
    );

  const counts = await countRows(prisma, CLEAR);
  const kept = await countRows(prisma, ['employees', 'departments', 'locations', 'users']);
  const list = CLEAR.map((t) => `"public"."${t}"`).join(', ');
  return {
    counts,
    kept,
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
    // TRUNCATE, not DELETE: the history and activity trails are append-only, and their row
    // triggers refuse a DELETE by design.
    sql: `TRUNCATE ${list} RESTART IDENTITY CASCADE;`,
  };
}

/** Empty the operational tables. Irreversible. */
export async function clearData(prisma: PrismaClient, plan: ClearPlan): Promise<void> {
  await prisma.$executeRawUnsafe(plan.sql);
  for (const sequence of SEQUENCES) {
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE IF EXISTS "${sequence}" RESTART WITH 1`);
  }
}

/** The database being pointed at, without its password. */
function target(): string {
  const raw = process.env.DATABASE_URL ?? '';
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return '(DATABASE_URL is not set)';
  }
}

async function main() {
  const confirmed = process.argv.includes('--yes');
  const prisma = new PrismaClient();
  try {
    const plan = await planClear(prisma);
    console.log(`Database: ${target()}\n`);

    const removable = Object.entries(plan.counts).filter(([, n]) => n > 0);
    if (!removable.length) {
      console.log('Nothing to clear — the operational tables are already empty.');
      return;
    }
    console.log('Would delete:');
    for (const [table, n] of removable) console.log(`  ${String(n).padStart(7)}  ${table}`);
    console.log(`  ${String(plan.total).padStart(7)}  rows in total\n`);
    console.log('Would keep:');
    for (const [table, n] of Object.entries(plan.kept))
      console.log(`  ${String(n).padStart(7)}  ${table}`);

    if (!confirmed) {
      console.log('\nNothing was deleted. Re-run with --yes to go ahead.');
      console.log(`\nThe statement it would run:\n  ${plan.sql}`);
      return;
    }

    await clearData(prisma, plan);
    const after = await planClear(prisma);
    console.log(`\nDeleted ${plan.total} rows. ${after.kept.employees} employees are still here.`);
    console.log('Asset tags and accessory codes start from 001 again.');
  } finally {
    await prisma.$disconnect();
  }
}

// Only when run as a script: the exported functions are used by the tests.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
