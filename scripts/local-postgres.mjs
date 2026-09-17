#!/usr/bin/env node
/**
 * Project-local PostgreSQL 16 for machines without Docker.
 * Data lives in .local/postgres (git-ignored). Runs in the foreground until Ctrl+C.
 *
 *   npm run db:local
 *
 * Connection: postgresql://itam:itam@localhost:5433/itam
 * (Port 5433 avoids clashing with other PostgreSQL installs on 5432.)
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = join(root, '.local', 'postgres');
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const databases = ['itam', 'itam_test'];

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'itam',
  password: 'itam',
  port,
  persistent: true,
  // Force UTF-8: on Windows initdb otherwise inherits the ANSI code page (WIN1252).
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (message) => console.error(String(message).trim()),
});

async function main() {
  if (!existsSync(join(databaseDir, 'PG_VERSION'))) {
    console.log(`Initialising PostgreSQL cluster in ${databaseDir} …`);
    await pg.initialise();
  }
  await pg.start();

  for (const name of databases) {
    try {
      await pg.createDatabase(name);
      console.log(`Created database "${name}"`);
    } catch (error) {
      if (!/already exists/i.test(String(error?.message ?? error))) throw error;
    }
  }

  console.log(`PostgreSQL ready on postgresql://itam:itam@localhost:${port}/itam (Ctrl+C to stop)`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping PostgreSQL …');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Keep the process alive.
  setInterval(() => {}, 1 << 30);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pg.stop();
  } catch {
    /* already stopped */
  }
  process.exit(1);
});
