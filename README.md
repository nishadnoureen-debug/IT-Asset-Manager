# IT Asset Management System

A secure, responsive web application for tracking company IT devices (laptops, desktops, monitors, mobiles,
tablets, printers, servers, network equipment, projectors and accessories) through their full lifecycle:
**Purchased → Registered → In stock → Assigned → Transferred / Returned → Repair → Available → Retired → Disposed**.

**Stack:** Next.js 15 + TypeScript · NestJS 11 + TypeScript · PostgreSQL 16 · Prisma · JWT with rotating refresh
tokens · S3-compatible storage · Docker · GitHub Actions

## What's included

| Area                  | Highlights                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication & RBAC | Argon2id passwords, short-lived access tokens, rotating httpOnly refresh cookies with reuse detection, lockout, password reset, self-registration (optionally with admin approval), 6 system roles + custom roles, 73 granular permissions with own / department / all data scopes |
| Assets                | CRUD, auto-generated asset tags, lifecycle transitions, history timeline, documents, retire / dispose / report lost                                                                                                                                                                |
| Assignments           | Assign, return (to stock or repair) and transfer in one transaction each; accessories, condition, e-signature, generated handover / return PDFs, employee acknowledgement                                                                                                          |
| QR codes              | Per-asset QR, printable A4 label sheets, phone camera scanning, scan result shows only the actions your role allows                                                                                                                                                                |
| Operations            | Accessories stock, maintenance & repairs with costs, warranty tracking, purchases & vendors, software licences with seat limits and encrypted keys, helpdesk tickets, inventory audits with discrepancy review                                                                     |
| Insight               | Role-aware dashboard, 10 reports exportable to CSV / Excel / PDF, notifications with daily expiry & overdue checks, append-only activity log                                                                                                                                       |

The screens are responsive; scanning, assigning and returning are designed phone-first.

## Repository layout

```
apps/
  api/          NestJS REST API (/api/v1), Prisma schema, migrations, seeds, tests
  web/          Next.js web client (App Router)
packages/
  shared/       API contracts, enums, labels, roles & permission catalogue
docker/         docker-compose (Postgres, api, web) and Dockerfiles
docs/           Implementation plan, database, security and deployment guides
scripts/        Project-local PostgreSQL for machines without Docker
.github/        CI workflow
```

## Run it locally

Prerequisites: Node.js 20.11+ (CI and Docker use Node 22).

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

Generate the two secrets and paste them into `apps/api/.env` (`JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`):

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64url')); console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

Start PostgreSQL in its own terminal. Without Docker this runs a project-local server on port 5433
(set `DATABASE_URL` in `apps/api/.env` to port 5433); with Docker use `npm run db:up` (port 5432).

```bash
npm run db:local
```

Apply migrations and create the first Super Admin (a strong password is generated and printed once):

```bash
npm run db:migrate
```

```bash
npm run user:create-admin -- --email you@company.com --name "Your Name"
```

Alternatively, open the sign-in page and choose **Create an account**: on a system with no active Super Admin the
first person to register becomes Super Admin. Everyone after that can sign in straight away with the Employee role;
an administrator gives them more access on **Users & roles**. **Settings** can require approval for new accounts or
turn registration off.

Optionally load demo data (employees, assets, assignments, tickets, licences, audits and one account per role;
the demo password is printed at the end):

```bash
npm run db:seed:demo
```

Start the API and the web app in two terminals, then open http://localhost:3000:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

API documentation (Swagger) is at http://localhost:4000/api/docs in development.

## Common commands

| Command                     | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `npm test`                  | API unit + pipeline e2e tests, web unit/component tests                          |
| `npm run test:db`           | API workflow & database integration tests against `itam_test` (needs PostgreSQL) |
| `npm run typecheck`         | Type-check every workspace                                                       |
| `npm run build`             | Production build of shared, api and web                                          |
| `npm run format`            | Format the codebase with Prettier                                                |
| `npm run db:migrate`        | Create/apply a development migration                                             |
| `npm run db:deploy`         | Apply migrations (staging/production)                                            |
| `npm run db:seed`           | Sync permissions, system roles and asset types (runs automatically in Docker)    |
| `npm run db:seed:demo`      | Load demo data (never in production)                                             |
| `npm run user:create-admin` | Create a Super Admin or reset one's password (`--reset-password`)                |
| `npm run db:studio`         | Browse data in Prisma Studio                                                     |

## Documentation

- [Implementation plan & acceptance criteria](docs/implementation-plan.md)
- [Database](docs/database.md): schema, integrity rules, roles and permissions
- [Security](docs/security.md): authentication, authorization, data protection
- [Deployment](docs/deployment.md): one-click Render Blueprint, Docker, staging/production, backups and
  restore tests

## Conventions

- Every response uses `{ success, data, meta? }` or `{ success: false, error: { code, message, details?, requestId } }`.
- Authorization is enforced by the API on every request; the UI only hides what you cannot do.
- Lifecycle operations are transactional and write both asset history and the activity log.
- Assets are never hard-deleted: they are retired and disposed of, and history is append-only.
- Secrets live only in environment variables; `.env` files are git-ignored.
