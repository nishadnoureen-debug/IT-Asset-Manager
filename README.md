# IT Asset Management System

Secure, responsive web application for tracking company IT devices (laptops, desktops, monitors, mobiles,
tablets, printers, servers, network equipment, projectors and accessories) through their full lifecycle.

**Stack:** Next.js + TypeScript · NestJS + TypeScript · PostgreSQL · Prisma · JWT · Docker · GitHub Actions

**Current phase:** 2 of 12 complete (Foundation, Database). See [docs/implementation-plan.md](docs/implementation-plan.md)
and [docs/database.md](docs/database.md).

## Repository layout

```
apps/
  api/          NestJS REST API (/api/v1) + Prisma
  web/          Next.js web client
packages/
  shared/       API contracts, enums, roles, permissions shared by api and web
docker/         docker-compose (Postgres, api, web) and Dockerfiles
docs/           Implementation plan and architecture notes
.github/        CI workflow
```

## Prerequisites

- Node.js 20.11+ (CI and Docker use Node 22)
- PostgreSQL 16, one of:
  - Docker: `npm run db:up` (port 5432)
  - No Docker: `npm run db:local` (project-local server on port 5433, runs in the foreground)

## Getting started

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

Start PostgreSQL in its own terminal (no Docker needed), then set `DATABASE_URL` in `apps/api/.env`
to port 5433:

```bash
npm run db:local
```

Apply migrations and seed roles, permissions and asset types:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Run the API (http://localhost:4000/api/v1, Swagger at http://localhost:4000/api/docs):

```bash
npm run dev:api
```

Run the web app (http://localhost:3000):

```bash
npm run dev:web
```

## Common commands

| Command                                                  | Purpose                                  |
| -------------------------------------------------------- | ---------------------------------------- |
| `npm test`                                               | API unit + e2e tests, web unit tests     |
| `npm run typecheck`                                      | Type-check all workspaces                |
| `npm run build`                                          | Production build of shared, api and web  |
| `npm run test:db`                                        | Database integration tests (`itam_test`) |
| `npm run db:migrate`                                     | Create/apply a dev migration             |
| `npm run db:deploy`                                      | Apply migrations (staging/production)    |
| `npm run db:seed`                                        | Sync permissions, roles, asset types     |
| `npm run db:studio`                                      | Browse data in Prisma Studio             |
| `docker compose -f docker/docker-compose.yml up --build` | Full stack in containers                 |

## Health endpoints

- `GET /api/v1/health` returns liveness (process up)
- `GET /api/v1/health/ready` returns readiness (database reachable) or `503` if not

## Conventions

- Every response uses `{ success, data, meta? }` or `{ success: false, error: { code, message, details?, requestId } }`.
- Authorization is enforced in the backend. Lifecycle operations are transactional and write history and activity logs.
- Assets are never hard-deleted: they move to Retired or Disposed.
- Secrets live only in environment variables, and `.env` files are git-ignored.
