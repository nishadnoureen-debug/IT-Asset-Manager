# Implementation Plan

Source of truth: _IT Asset Management — Complete Development Specification & Claude Code Prompt Pack_.
The build proceeds phase by phase and the project must be runnable after each one. A feature counts as
done only when it meets the Definition of Done (spec §13): migration, APIs, authorization, validation,
frontend integration, loading/empty/error states, audit logging, automated tests, and updated docs and commands.

## Architecture

| Layer    | Choice                                                                                       |
| -------- | -------------------------------------------------------------------------------------------- |
| Monorepo | npm workspaces: `apps/web`, `apps/api`, `packages/shared`                                    |
| Web      | Next.js (App Router) + TypeScript + Tailwind CSS, responsive and mobile-first for QR flows   |
| API      | NestJS + TypeScript, REST under `/api/v1`, standard response envelope                        |
| Data     | PostgreSQL 16 + Prisma ORM, transactional lifecycle operations, soft delete / Retired status |
| Auth     | JWT access token (short-lived) + rotating refresh token, Argon2 hashing, granular RBAC       |
| Files    | S3-compatible storage (MinIO in dev) for photos, invoices, warranties, PDFs                  |
| Ops      | Docker, GitHub Actions CI, pino structured logs with request ids                             |

### API contract (applies to every module)

- Success: `{ "success": true, "data": …, "meta"?: { page, limit, total, totalPages } }`
- Error: `{ "success": false, "error": { code, message, details?, requestId, path, timestamp } }`
- List endpoints accept `page`, `limit` (≤100), `search`, `sortBy` (whitelisted per module) and `sortOrder`.
- Validation errors → `400 VALIDATION_ERROR` with `details: [{ field, errors[] }]`; unknown fields are rejected.
- Authorization is always enforced in the backend. The frontend only hides UI.

## Phases

| #   | Phase                   | Deliverables                                                                                                                | Status   |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Foundation              | Monorepo, web + api skeletons, Prisma wiring, env validation, `/api/v1`, logging, errors, validation, Docker, health, tests | **Done** |
| 2   | Database                | Full normalized schema (spec §3): PKs, FKs, indexes, uniques, enums, timestamps, soft delete; initial migration; seed       | **Done** |
| 3   | Auth & RBAC             | Login/logout/refresh/me, password reset foundation, 6 roles, permissions, guards, activity logs                             | Next     |
| 4   | Core Assets             | Asset types, assets, departments, locations, vendors, purchases, warranty, history, lifecycle transitions                   | Planned  |
| 5   | Employees & Assignments | Employees, assign/return/transfer (transactional), accessories, condition, signatures, handover PDFs                        | Planned  |
| 6   | QR/Barcode              | QR generation, labels, mobile scan → asset + role-allowed actions                                                           | Planned  |
| 7   | Maintenance & Warranty  | Repair records, technician/vendor, costs, statuses, warranty expiry queries and alerts                                      | Planned  |
| 8   | Helpdesk                | Tickets, comments, assignment, resolve/close                                                                                | Planned  |
| 9   | Software & Licenses     | Catalogue, licenses, seat allocation limits, expiry, utilization                                                            | Planned  |
| 10  | Inventory Audit         | Audit sessions, scans, expected vs actual, discrepancies, reports                                                           | Planned  |
| 11  | Reports & Notifications | Report APIs + UI, CSV/XLSX/PDF export, notifications                                                                        | Planned  |
| 12  | Production hardening    | Security review, rate limits, uploads, CORS, backups, indexes, CI/CD, deployment docs                                       | Planned  |

The MVP (spec §8) is phases 1–7, plus the dashboard, reports and audit logs.

## Phase 1 — Foundation (complete)

**Files**

- Root: `package.json` (workspaces), `tsconfig.base.json`, `.gitignore`, `.prettierrc.json`, `.editorconfig`, `.dockerignore`
- `packages/shared`: API envelope types, health types, lifecycle statuses, roles and permission keys
- `apps/api`:
  - `src/main.ts`, `src/app.module.ts`, `src/app.setup.ts` (the pipeline shared by the runtime and e2e tests)
  - `src/config/env.validation.ts`: zod-validated environment that fails fast on boot
  - `src/prisma/*`: global `PrismaService` with a lazy connection
  - `src/common/filters/all-exceptions.filter.ts`: error envelope, Prisma error mapping, no leaked internals
  - `src/common/interceptors/response-envelope.interceptor.ts` and `@SkipEnvelope()`
  - `src/common/validation/validation.factory.ts`: global whitelist validation
  - `src/common/pagination/*`: `PaginationQueryDto` and `PaginatedResult`
  - `src/common/logging/logger.config.ts`: pino, request ids, secret redaction
  - `src/health/*`: `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (DB check, 503 when down)
  - `prisma/schema.prisma`: datasource and generator (models arrive in Phase 2)
  - Tests: unit tests for config, filter, interceptor and pagination, plus `test/app.e2e-spec.ts`
- `apps/web`: Next.js app with a typed API client (`src/lib/api-client.ts`), `useApiHealth` hook, system status page, and vitest tests
- `docker/`: `docker-compose.yml` (Postgres, api, web), `api.Dockerfile`, `web.Dockerfile`
- `.github/workflows/ci.yml`: format, prisma validate, typecheck, tests, build

**Acceptance criteria**

- [x] `npm install` builds the shared package and generates the Prisma client
- [x] The API boots with a validated env and refuses to start on invalid config
- [x] All routes are served under `/api/v1`; `/api/docs` hosts Swagger outside production
- [x] Every response uses the success/error envelope; each request carries `x-request-id`
- [x] Invalid or unknown payload fields → `400 VALIDATION_ERROR` with field details
- [x] Unhandled errors → `500` with a generic message, logged with the request id
- [x] Readiness returns `503` with no connection details when the DB is unreachable
- [x] Helmet security headers, CORS allow-list and a global rate limit are applied
- [x] API unit and e2e tests and web unit tests pass; typecheck and build succeed
- [x] No business modules are implemented yet

## Phase 2 — Database (complete)

Details: [database.md](database.md).

**Files**

- `apps/api/prisma/schema.prisma`: 27 tables and 20 enums covering every table in spec §3, plus `ticket_comments`
  (needed by `POST /tickets/:id/comments`)
- `apps/api/prisma/migrations/*_init/migration.sql`: generated DDL plus hand-written partial unique indexes,
  CHECK constraints and append-only triggers
- `apps/api/src/database/seed.ts`: idempotent seed for 73 permissions, 6 system roles (216 grants) and 10 asset types
- `packages/shared`: permission catalogue, role→permission mapping, role details, assignment statuses
- `apps/api/test/database.db-spec.ts` (+ `test/db/*`, `test/jest-db.json`): 26 integration tests against a real PostgreSQL
- `scripts/local-postgres.mjs`: project-local PostgreSQL 16 on port 5433 for machines without Docker
- CI runs `npm run test:db`; the API Docker image runs `migrate deploy` and then the seed on start

**Acceptance criteria**

- [x] Every table from spec §3, with PKs, FKs, indexes, unique constraints, enums, timestamps and soft-delete fields
- [x] `asset_assignments` is the assignment history; `assets` has no `employee_id`; only one ACTIVE assignment per asset
- [x] History-bearing FKs are RESTRICT, and `asset_history` / `activity_logs` are append-only at the database level
- [x] The initial migration applies cleanly to an empty database, with no drift against `schema.prisma` (tested)
- [x] The seed is idempotent and system roles get exactly their catalogue permissions (tested)
- [x] The database is UTF-8 and stores non-Latin text (tested)
- [x] All existing unit, e2e and web tests still pass; typecheck, format and build succeed

## Phase 3 — Auth & RBAC (next)

Planned work: Argon2id password hashing, a login/logout/refresh/me flow with short-lived access JWTs and
rotating, revocable refresh tokens (new `refresh_tokens` and `password_reset_tokens` tables), lockout on
repeated failures, a `@RequirePermissions()` guard backed by `role_permissions`, data-scope helpers
(`*.view_own` / `*.view_department`), activity logging for auth events, a bootstrap Super Admin command,
and authorization tests, including IDOR and bypass attempts.
