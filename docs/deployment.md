# Deployment

## Topology

```
Browser ──HTTPS──▶ reverse proxy / load balancer ──▶ web (Next.js, :3000) ──/api/v1──▶ api (NestJS, :4000) ──▶ PostgreSQL 16
                                                                                         └──────────────────▶ S3-compatible storage
```

The browser only talks to the web origin. Next.js forwards `/api/v1/*` to the API (`API_INTERNAL_URL`), so the
refresh cookie is first-party and the API does not need to be publicly reachable.

## Docker Compose (single host / staging)

```bash
cp docker/.env.example docker/.env
```

Fill in `docker/.env` — at minimum `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY` and `PUBLIC_WEB_URL`
(generate secrets with the commands in the file). Then:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build
```

The API container applies pending migrations and syncs the permission catalogue on every start. Create the first
administrator:

```bash
docker compose -f docker/docker-compose.yml exec api node dist/database/create-admin.js --email you@company.com --name "Your Name"
```

Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik, a cloud load balancer) in front of the `web` service.

## Production checklist

| Item             | Notes                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS everywhere | Required for `Secure` cookies and camera access for QR scanning.                                                                                                                                                                      |
| Secrets          | `JWT_ACCESS_SECRET` (≥ 32 chars) and `ENCRYPTION_KEY` (32 bytes, base64) from a secret manager. **Back up `ENCRYPTION_KEY`** — without it stored licence keys cannot be decrypted. Rotating the JWT secret signs everyone out (safe). |
| Database         | Managed PostgreSQL 16 or a hardened instance; the app user needs DDL rights only for `migrate deploy` (or run migrations from CI with a separate role).                                                                               |
| Storage          | `STORAGE_DRIVER=s3` with a private bucket (versioning on). The local driver is fine for a single host with a persistent volume.                                                                                                       |
| `PUBLIC_WEB_URL` | The public URL — it is printed into QR labels. Changing it later requires reprinting labels (or a redirect from the old host).                                                                                                        |
| `TRUST_PROXY`    | Set so `req.ip` is the real client (rate limits, lockout and logs). Default `loopback`; in Compose `uniquelocal`.                                                                                                                     |
| Rate limits      | `THROTTLE_LIMIT` per `THROTTLE_TTL_MS` per client IP (default 600/min); auth routes have stricter fixed limits.                                                                                                                       |
| Scheduler        | `ENABLE_SCHEDULER=true` on exactly one API instance if you scale horizontally (daily alert job).                                                                                                                                      |
| Swagger          | Disabled automatically in production.                                                                                                                                                                                                 |
| Logs             | JSON to stdout — ship to your log platform; alert on 5xx rate and `auth.refresh_reuse_detected`.                                                                                                                                      |

## Backups and restore tests

- **Database**: daily `pg_dump -Fc` (or managed PITR) retained ≥ 30 days, plus WAL archiving if RPO < 24 h.
- **Files**: bucket versioning / replication (S3) or volume snapshots (local driver).
- **Restore test (monthly)**: restore the latest dump into a scratch database, point a staging API at it, run
  `npx prisma migrate status` (must be up to date) and sign in; record the time taken.

```bash
pg_dump -Fc "$DATABASE_URL" -f itam-$(date +%F).dump
```

```bash
pg_restore --clean --if-exists -d "$RESTORE_DATABASE_URL" itam-YYYY-MM-DD.dump
```

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request: format check → Prisma validate → typecheck →
unit/e2e tests → database integration tests against a PostgreSQL service → production build. A typical release
pipeline adds: build and push both images, run `prisma migrate deploy` against staging, smoke-test
`/api/v1/health/ready`, then promote the same images to production.

## Upgrades

1. Back up the database.
2. Deploy the new images; the API runs `prisma migrate deploy` before serving traffic.
3. Check `/api/v1/health/ready` returns 200.

Migrations are forward-only; to roll back, restore the backup taken in step 1 and redeploy the previous images.
