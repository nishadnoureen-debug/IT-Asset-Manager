// Starts the API (private, 127.0.0.1:4000) and the Next.js server (public, $PORT) in one container.
// 1. Apply database migrations and sync reference data.
// 2. Start the API and wait until it answers its health check.
// 3. Start the web server, so the host only routes traffic once both halves are ready.
// If either process exits, the other is stopped and the container exits so the host restarts it.
import { spawn, spawnSync } from 'node:child_process';

const API_DIR = '/repo/apps/api';
const API_PORT = '4000';
const WEB_PORT = process.env.PORT || '3000';
const READY_TIMEOUT_MS = 180_000;

const log = (message) => console.log(`[start] ${message}`);
const apiEnv = { ...process.env, HOST: '127.0.0.1', PORT: API_PORT };

// Neon's pooled hosts (…-pooler.…) run PgBouncer in transaction mode, which Prisma migrations cannot
// use. The direct host serves this app's small connection pool as well.
if (apiEnv.DATABASE_URL?.includes('-pooler.')) {
  apiEnv.DATABASE_URL = apiEnv.DATABASE_URL.replace('-pooler.', '.');
  log('Using the direct (unpooled) database host');
}

function runOrExit(name, command, args) {
  log(name);
  const result = spawnSync(command, args, { cwd: API_DIR, env: apiEnv, stdio: 'inherit' });
  if (result.status !== 0) {
    log(`${name} failed (exit ${result.status ?? result.signal})`);
    process.exit(1);
  }
}

runOrExit('Applying database migrations', 'npx', ['prisma', 'migrate', 'deploy']);
runOrExit('Syncing roles, permissions and asset types', 'node', ['dist/database/seed.js']);

const children = new Set();
let stopping = false;

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 10_000).unref();
  const exitWhenDone = () => children.size === 0 && process.exit(exitCode);
  for (const child of children) child.once('exit', exitWhenDone);
  exitWhenDone();
}

function start(name, args, options) {
  const child = spawn('node', args, { stdio: 'inherit', ...options });
  children.add(child);
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      log(`${name} stopped (${signal ?? `exit ${code}`}); shutting down`);
      stopAll(1);
    }
  });
  return child;
}

process.on('SIGTERM', () => stopAll(0));
process.on('SIGINT', () => stopAll(0));

start('API', ['dist/main'], { cwd: API_DIR, env: apiEnv });

const deadline = Date.now() + READY_TIMEOUT_MS;
while (!stopping) {
  const ok = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/health`)
    .then((res) => res.ok)
    .catch(() => false);
  if (ok) break;
  if (Date.now() > deadline) {
    log('API did not become healthy in time');
    stopAll(1);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (!stopping) {
  log(`API ready; starting the web server on port ${WEB_PORT}`);
  // The web server needs no secrets: it only proxies /api/v1 to the API.
  start('Web server', ['apps/web/server.js'], {
    cwd: '/web',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: WEB_PORT,
      HOSTNAME: '0.0.0.0',
    },
  });
}
