# Deployment

## Topology

```
Browser ──HTTPS──▶ reverse proxy / load balancer ──▶ web (Next.js, :3000) ──/api/v1──▶ api (NestJS, :4000) ──▶ PostgreSQL 16
                                                                                         └──────────────────▶ S3-compatible storage
```

The browser only talks to the web origin. Next.js forwards `/api/v1/*` to the API (`API_INTERNAL_URL`), so the
refresh cookie is first-party and the API does not need to be publicly reachable.

## Render + Neon (free hosting)

[`render.yaml`](../render.yaml) is a Render Blueprint for a **free** setup:

| Part       | Where                              | Notes                                                                        |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `arc-itam` | Render web service, `free` plan    | Web app and API in one container (`docker/app.Dockerfile`), HTTPS.           |
| Database   | [Neon](https://neon.com) free plan | PostgreSQL. Uploaded files are stored in it too (`STORAGE_DRIVER=database`). |

What "free" means here:

- The service **sleeps after 15 minutes without visits**; the next visit wakes it in about a minute.
- Neon's free plan includes 0.5 GB of storage — enough for thousands of assets and a few hundred small
  scanned documents. Keep uploads small (PDF or compressed photos).
- Daily alerts (expiring warranties and licences, overdue returns) run each time the service wakes up.
- To remove the sleep later, change `plan: free` to `plan: 0.5c-512mb` (US$7/month) in `render.yaml`.

### 1. Create the database (Neon)

1. Sign up at [neon.com](https://neon.com) (GitHub or Google sign-in works) and create a project. Pick the region
   **AWS Europe Central 1 (Frankfurt)**, next to Render's Frankfurt region.
2. Open **Connect**, and copy the connection string. It looks like
   `postgresql://neondb_owner:…@ep-….eu-central-1.aws.neon.tech/neondb?sslmode=require`. Either the pooled
   (`-pooler`) or direct string works: the app switches to the direct host for migrations.

### 2. Deploy the app (Render)

1. Sign in at [dashboard.render.com](https://dashboard.render.com) and open
   `https://render.com/deploy?repo=https://github.com/nishadnoureen-debug/IT-Asset-Manager` (or **New → Blueprint**
   and pick the repository). Do not use **New → Web Service**: that form ignores `render.yaml`.
2. Render asks for two values:
   - `DATABASE_URL`: the Neon connection string.
   - `BOOTSTRAP_ADMIN_EMAIL`: your email. Only this address can create the first account.
3. Click **Deploy Blueprint**. The first build takes about 10 minutes; the free plan needs no payment card.
4. Open the service URL (`https://arc-itam.onrender.com` unless the name was taken), choose **Create an account**
   and register with the `BOOTSTRAP_ADMIN_EMAIL` address. You become the Super Admin and registration closes
   automatically (reopen it in **Settings** if you ever need more users).
5. Copy `ENCRYPTION_KEY` from the service's **Environment** page into your password manager. Without it, stored
   licence keys cannot be decrypted after moving the database.

The address printed on QR labels is the service's Render URL (`RENDER_EXTERNAL_URL`). With a custom domain, set
`PUBLIC_WEB_URL` on the service. Every push to `main` redeploys once the GitHub CI checks pass
(`autoDeployTrigger: checksPass`); database migrations run before the app starts.

Backups: Neon keeps a short restore window on the free plan. Export your data regularly from **Reports**
(Excel), or run `pg_dump` with the Neon connection string.

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

| Item             | Notes                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS everywhere | Required for `Secure` cookies and camera access for QR scanning.                                                                                                                                                                                                                                                                                          |
| Secrets          | `JWT_ACCESS_SECRET` (≥ 32 chars) and `ENCRYPTION_KEY` (32 bytes, base64) from a secret manager. **Back up `ENCRYPTION_KEY`** — without it stored licence keys cannot be decrypted. Rotating the JWT secret signs everyone out (safe).                                                                                                                     |
| Database         | Managed PostgreSQL 16 or a hardened instance; the app user needs DDL rights only for `migrate deploy` (or run migrations from CI with a separate role).                                                                                                                                                                                                   |
| Storage          | `STORAGE_DRIVER=s3` with a private bucket (versioning on). The local driver is fine for a single host with a persistent volume; `database` stores files in PostgreSQL (hosts without a disk).                                                                                                                                                             |
| `PUBLIC_WEB_URL` | The public URL — it is printed into QR labels. Changing it later requires reprinting labels (or a redirect from the old host).                                                                                                                                                                                                                            |
| `TRUST_PROXY`    | Set so `req.ip` is the real client (rate limits, lockout and logs). Default `loopback`; in Compose `uniquelocal`.                                                                                                                                                                                                                                         |
| Rate limits      | `THROTTLE_LIMIT` per `THROTTLE_TTL_MS` per client IP (default 600/min); auth routes have stricter fixed limits.                                                                                                                                                                                                                                           |
| Scheduler        | `ENABLE_SCHEDULER=true` on exactly one API instance if you scale horizontally (daily alert job).                                                                                                                                                                                                                                                          |
| Registration     | Self-registration is on by default and gives new accounts the Employee role immediately. Set `BOOTSTRAP_ADMIN_EMAIL` (or create the first Super Admin before the site is reachable) — until one exists, the first person to register becomes Super Admin. On a public URL, turn on "Require administrator approval" or turn registration off in Settings. |
| Swagger          | Disabled automatically in production.                                                                                                                                                                                                                                                                                                                     |
| Logs             | JSON to stdout — ship to your log platform; alert on 5xx rate and `auth.refresh_reuse_detected`.                                                                                                                                                                                                                                                          |

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
