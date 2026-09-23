# Implementation Plan

Source of truth: _IT Asset Management — Complete Development Specification & Claude Code Prompt Pack_.
A feature counts as done only when it meets the Definition of Done (spec §13): migration, APIs, authorization,
validation, frontend integration, loading/empty/error states, audit logging, automated tests, and updated docs and
commands.

## Architecture

| Layer    | Choice                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Monorepo | npm workspaces: `apps/web`, `apps/api`, `packages/shared`                                                                  |
| Web      | Next.js 15 (App Router) + TypeScript + Tailwind CSS + TanStack Query; responsive, phone-first scan/assign/return           |
| API      | NestJS 11 + TypeScript, REST under `/api/v1`, standard response envelope, Swagger in development                           |
| Data     | PostgreSQL 16 + Prisma 6; transactional lifecycle operations; soft delete; append-only history                             |
| Auth     | Argon2id, 15-min JWT access tokens, rotating httpOnly refresh cookies with reuse detection, granular RBAC with data scopes |
| Files    | S3-compatible storage (local-disk driver for development)                                                                  |
| Ops      | Docker, GitHub Actions CI, pino structured logs with request ids                                                           |

### API contract (applies to every module)

- Success: `{ "success": true, "data": …, "meta"?: { page, limit, total, totalPages } }`
- Error: `{ "success": false, "error": { code, message, details?, requestId, path, timestamp } }`
- Lists accept `page`, `limit` (≤ 100), `search`, `sortBy` (whitelisted per endpoint) and `sortOrder`.
- Validation errors → `400 VALIDATION_ERROR` with `details: [{ field, errors[] }]`; unknown fields are rejected.
- Invalid lifecycle transitions → `422 INVALID_STATE`; conflicts → `409` with a specific code
  (`CONFLICT`, `LICENSE_SEATS_EXHAUSTED`, `ACCESSORY_OUT_OF_STOCK`, `CONCURRENT_UPDATE`…).
- Out-of-scope records return `404` (never reveal existence).

## Phases

| #   | Phase                   | Status                                    |
| --- | ----------------------- | ----------------------------------------- |
| 1   | Foundation              | **Done**                                  |
| 2   | Database                | **Done**                                  |
| 3   | Auth & RBAC             | **Done**                                  |
| 4   | Core assets             | **Done**                                  |
| 5   | Employees & assignments | **Done**                                  |
| 6   | QR / barcode            | **Done**                                  |
| 7   | Maintenance & warranty  | **Done**                                  |
| 8   | Asset requests          | **Done**                                  |
| 9   | Software & licences     | **Done**                                  |
| 10  | Inventory audit         | **Done**                                  |
| 11  | Reports & notifications | **Done**                                  |
| 12  | Production hardening    | **Done** (see "Remaining before go-live") |

## Delivered, by spec section

### Functional modules (spec §2) and UI screens (spec §6)

| #   | Screen                                                                               | Route                                                        | API                                                       |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | Login (+ register, forgot / reset password)                                          | `/login`, `/register`, `/forgot-password`, `/reset-password` | `/auth/*`                                                 |
| 2   | Dashboard (role-aware; "My equipment" for employees)                                 | `/dashboard`                                                 | `/dashboard/*`                                            |
| 3   | Asset list (filters, sort, label printing, export)                                   | `/assets`                                                    | `GET /assets`                                             |
| 4   | Add / edit asset                                                                     | `/assets/new`, `/assets/[id]/edit`                           | `POST/PATCH /assets`                                      |
| 5   | Asset details (overview, assignments, history, maintenance, documents, software, QR) | `/assets/[id]`                                               | `/assets/:id/*`                                           |
| 6   | Asset assignment (employee or location, accessories, signature)                      | `/assets/[id]/assign`                                        | `POST /assets/:id/assign`                                 |
| 7   | Asset return (to stock or repair, missing/damaged accessories)                       | `/assets/[id]/return`                                        | `POST /assets/:id/return`                                 |
| 8   | Asset transfer                                                                       | `/assets/[id]/transfer`                                      | `POST /assets/:id/transfer`                               |
| 9   | Employee list                                                                        | `/employees`                                                 | `/employees`                                              |
| 10  | Employee details                                                                     | `/employees/[id]`                                            | `/employees/:id/*`                                        |
| 11  | QR scanner (camera + manual; label links open it)                                    | `/scan`, `/qr/[token]`                                       | `POST /qr/scan`, `/assets/:id/qr*`, `/qr/labels`          |
| 12  | Accessories                                                                          | `/accessories`                                               | `/accessories`, `/accessory-assignments`                  |
| 13  | Maintenance / repairs                                                                | `/maintenance`, `/maintenance/[id]`                          | `/maintenance/*`                                          |
| 14  | Warranty dashboard                                                                   | `/warranty`                                                  | `/warranties/*`, `/assets/:id/warranty`                   |
| 15  | Software & licences                                                                  | `/software`, `/software/licenses/[id]`                       | `/software`, `/licenses/*`                                |
| 16  | Asset requests & approvals                                                           | `/requests`, `/requests/[id]`                                | `/requests/*`                                             |
| 17  | Inventory audit                                                                      | `/audits`, `/audits/[id]`                                    | `/audits/*`                                               |
| 18  | Reports                                                                              | `/reports`                                                   | `/reports/:type` (format: json, csv, xlsx, pdf)           |
| 19  | Notifications                                                                        | `/notifications`                                             | `/notifications/*`                                        |
| 20  | Users & roles (permission matrix)                                                    | `/users`, `/users/roles/[id]`                                | `/users/*`, `/roles/*`, `/permissions`                    |
| 21  | Settings (organisation, departments, locations, asset types)                         | `/settings`                                                  | `/settings`, `/departments`, `/locations`, `/asset-types` |
| –   | Purchases & vendors                                                                  | `/purchases`, `/purchases/[id]`                              | `/purchases`, `/vendors`                                  |
| –   | Activity log (Super Admin)                                                           | `/activity-logs`                                             | `/activity-logs`                                          |
| –   | My profile / change password                                                         | `/profile`                                                   | `/auth/me`, `/auth/change-password`                       |

All spec §5 endpoints are implemented, plus these supporting ones: `POST /assignments/:id/acknowledge`,
`GET /warranties/summary`, `POST /audits/:id/close|cancel`, `PATCH /audits/:id/items/:itemId`, `GET /reports`,
`GET /notifications/unread-count`, `POST /notifications/run-checks`, `GET /users/staff`, `POST /auth/change-password`,
`/documents` upload/download/delete.

### Core workflows (spec §7)

| Workflow  | Implementation                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New asset | Register (tag auto-generated from settings prefix) → QR token created → link purchase/vendor → attach invoice/warranty → In stock                                                                |
| Assign    | Scan → verify → employee and/or location → accessories (stock decremented) → condition → optional signature → handover PDF → Assigned; unsigned hand-overs notify the employee to acknowledge    |
| Return    | Scan → condition → accessories (usable back to stock; missing/damaged written off) → signature → return PDF → In stock **or** In repair (opens a maintenance job)                                |
| Transfer  | Close old assignment as TRANSFERRED → new linked assignment → accessories move with the device → history + activity log → handover PDF                                                           |
| Repair    | Maintenance record → technician/vendor → start (In repair) → complete with costs/notes → Available or Assigned                                                                                   |
| Audit     | Create for location (incl. sub-locations) and/or department → start (snapshot) → scan → found / unexpected / wrong location / damaged → complete (unscanned → missing) → review → close → report |

### Testing (spec §9)

| Suite                   | Command                         | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API unit (39)           | `npm test -w @itam/api`         | env validation, error filter, envelope, pagination, lifecycle transitions, allowed actions per role, scoping, crypto, file-type detection, QR parsing, CSV injection, activity-log redaction                                                                                                                                                                                                                                                                                                                                                        |
| API pipeline e2e (9)    | `npm run test:e2e -w @itam/api` | prefix, envelope, validation, request ids, security headers, health                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| API workflows + DB (72) | `npm run test:db`               | migrations & no drift, constraints & triggers, seed; login, lockout, refresh rotation/reuse/race, logout, reset, disabled users, self-registration (instant and approval modes); RBAC, privilege escalation, IDOR/data scope; full asset lifecycle incl. concurrency; licence seat limits & key encryption; asset requests (approve, reject, fulfil, scope); audits; report exports & formula injection; upload validation & database file storage; owner-only first account; handover / transfer / return / asset request form content; dashboards |
| Web (25)                | `npm test -w @itam/web`         | API client (refresh, single-flight, anonymous calls), components, permission-filtered navigation, registration page, form settings                                                                                                                                                                                                                                                                                                                                                                                                                  |

Not yet automated: browser E2E (Playwright), load/performance tests and visual regression — see below.

## Remaining before go-live

- Email delivery for password reset and notifications (hooks are in place; see [security.md](security.md)).
- Browser E2E suite (Playwright) for the six core workflows, and a load test of list/report endpoints.
- Unicode font for PDF exports (Arabic names currently render as `?` in PDFs only).
- HTTPS deployment, backups and a restore rehearsal as described in [deployment.md](deployment.md).
- Optional: approval workflows for department managers (spec §4 "configured approvals" — no approval rules are
  defined in the spec yet, so none are enforced).
