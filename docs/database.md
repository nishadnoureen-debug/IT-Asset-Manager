# Database

PostgreSQL 16 with Prisma ORM. The schema is in [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
and the migrations are in [`apps/api/prisma/migrations`](../apps/api/prisma/migrations).

## Running PostgreSQL locally

| Option                   | Command            | Connection string                            |
| ------------------------ | ------------------ | -------------------------------------------- |
| Docker                   | `npm run db:up`    | `postgresql://itam:itam@localhost:5432/itam` |
| Project-local, no Docker | `npm run db:local` | `postgresql://itam:itam@localhost:5433/itam` |

`db:local` runs PostgreSQL 16 from the `embedded-postgres` npm package. It needs no admin rights,
keeps its data in `.local/postgres` (git-ignored) and runs in the foreground until Ctrl+C. It creates the
`itam` and `itam_test` databases with UTF-8 encoding. Set `DATABASE_URL` in `apps/api/.env` to match
whichever option you use.

## Commands

| Command                | Purpose                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `npm run db:migrate`   | Create/apply migrations in development (`prisma migrate dev`)                          |
| `npm run db:deploy`    | Apply pending migrations in staging/production (`prisma migrate deploy`)               |
| `npm run db:seed`      | Sync permissions, system roles and default asset types (idempotent)                    |
| `npm run db:seed:demo` | Load demo data through the real services (never in production)                         |
| `npm run db:reset`     | Drop, re-migrate and re-seed the dev database (**destroys data**)                      |
| `npm run db:studio`    | Browse data in Prisma Studio                                                           |
| `npm run test:db`      | Integration tests against `itam_test`: migrations, constraints, seed and API workflows |

The Docker API image runs `migrate deploy` and then the compiled seed on every start.

## Conventions

- **Keys:** UUID primary keys. Asset requests, maintenance and audit sessions also get a sequential `number` for
  human-readable references such as TCK-000042.
- **Naming:** models use camelCase in Prisma and map to `snake_case` tables and columns.
- **Types:** `timestamptz` for instants, `date` for calendar dates (purchase and warranty), `numeric(14,2)` for
  money, and `char(3)` ISO-4217 currency codes checked with `^[A-Z]{3}$`.
- **Soft delete:** master data (departments, locations, employees, vendors, purchases, assets, accessories,
  software, licences, documents, users) has `deleted_at`. Assets end their life as `RETIRED` or `DISPOSED`.
  Foreign keys from history tables use `RESTRICT`, so hard-deleting referenced data fails.
- **Emails** are stored lower-case (CHECK constraint), so the unique indexes are effectively case-insensitive.
- **Secrets:** licence keys are stored in `license_key_encrypted` (encrypted by the application). Passwords
  are stored as `password_hash` only.

## Domain model

```mermaid
erDiagram
  departments ||--o{ employees : has
  locations ||--o{ employees : based_at
  locations ||--o{ locations : contains
  employees ||--o| users : "login for"
  users ||--o{ user_roles : ""
  roles ||--o{ user_roles : ""
  roles ||--o{ role_permissions : ""
  permissions ||--o{ role_permissions : ""

  asset_types ||--o{ assets : classifies
  vendors ||--o{ purchases : supplies
  purchases ||--o{ assets : bought_in
  locations ||--o{ assets : stored_at
  departments ||--o{ assets : owns

  assets ||--o{ asset_assignments : "assigned via"
  employees ||--o{ asset_assignments : receives
  asset_assignments |o--o| asset_assignments : "transferred from"
  assets ||--o{ asset_history : "lifecycle trail"
  asset_assignments ||--o{ accessory_assignments : "handed over with"
  accessories ||--o{ accessory_assignments : ""

  assets ||--o{ maintenance : repaired_in
  employees ||--o{ asset_requests : raises
  software ||--o{ software_licenses : ""
  software_licenses ||--o{ software_assignments : seats
  audit_sessions ||--o{ audit_items : ""
  assets ||--o{ audit_items : scanned_as
  assets ||--o{ documents : ""
  users ||--o{ notifications : ""
  users ||--o{ activity_logs : actor
```

## Tables

| Area         | Tables                                                            |
| ------------ | ----------------------------------------------------------------- |
| Organisation | `departments`, `locations` (hierarchical), `employees`            |
| Procurement  | `vendors`, `purchases`                                            |
| Assets       | `asset_types`, `assets`, `asset_assignments`, `asset_history`     |
| Accessories  | `accessories` (quantity-tracked), `accessory_assignments`         |
| Maintenance  | `maintenance`                                                     |
| Software     | `software`, `software_licenses`, `software_assignments`           |
| Requests     | `asset_requests`                                                  |
| Documents    | `documents` (file metadata; files go to S3-compatible storage)    |
| Audits       | `audit_sessions`, `audit_items`                                   |
| Access       | `users`, `roles`, `permissions`, `user_roles`, `role_permissions` |
| System       | `notifications`, `activity_logs`, `settings`                      |
| Auth         | `refresh_tokens`, `password_reset_tokens` (hashed tokens only)    |

`asset_requests` replaces the helpdesk tables from spec §3: equipment is asked for, approved or rejected, and
then handed over, with a printable form attached to the request.
`refresh_tokens`, `password_reset_tokens` and `settings` were added with authentication and the Settings screen
(migration `auth_and_settings`, which also creates the `asset_tag_seq` sequence used for generated tags).

### Assignment model

`asset_assignments` is the **historical source of truth** for assignments (spec §3). `assets` has no current
`employee_id` column. The current holder is the single row with `status = 'ACTIVE'`.

- **Assign:** insert an `ACTIVE` row and set the asset to `ASSIGNED`.
- **Return:** set the row to `RETURNED` with `returned_at` and `condition_at_return`, and set the asset to
  `IN_STOCK` or `IN_REPAIR`.
- **Transfer:** set the old row to `TRANSFERRED`, then insert a new `ACTIVE` row with `previous_assignment_id`
  pointing at the old one.

Each operation runs in one transaction and writes `asset_history` and `activity_logs`.

## Database-enforced rules

Prisma can't express these rules, so they live as hand-written SQL at the end of the initial migration.
`npm run test:db` has at least one test for each rule in this table.

| Rule                                                                           | Mechanism                                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| At most one ACTIVE assignment per asset                                        | Partial unique index `asset_assignments_one_active_per_asset`        |
| An assignment targets an employee and/or a location                            | CHECK `asset_assignments_assignee_required`                          |
| `status = ACTIVE` ⇔ `returned_at IS NULL`, and return happens after assignment | CHECK constraints on `asset_assignments` and `accessory_assignments` |
| Accessory stock: 0 ≤ available ≤ total                                         | CHECK `accessories_quantities_valid`                                 |
| A licence seat goes to exactly one asset **or** one employee                   | CHECK `software_assignments_exactly_one_target`                      |
| The same asset/employee can't hold a seat of one licence twice at once         | Partial unique indexes `software_assignments_active_*`               |
| Non-negative money, valid ISO currency, end dates ≥ start dates                | CHECK constraints on assets, purchases, maintenance and licences     |
| An audit item references an asset or a raw scanned code                        | CHECK `audit_items_asset_or_code`                                    |
| Lower-case emails                                                              | CHECK on `users` and `employees`                                     |
| `asset_history` and `activity_logs` are append-only                            | `BEFORE UPDATE OR DELETE` triggers raise `restrict_violation`        |

Licence over-allocation (`seats`, `allow_over_allocation`) is checked in the application inside the
assignment transaction, because it depends on a count across rows.

## Roles and permissions

The catalogue of 72 permission keys and the role-to-permission mapping live in
[`packages/shared/src/constants/permissions.ts`](../packages/shared/src/constants/permissions.ts), shared by the
API, the web app and the seed. Where spec §4 limits a role's data scope, the scope is part of the key:
`asset.view` (all), `asset.view_department` or `asset.view_own`.

| Role               | Permissions                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| Super Admin        | All 73                                                                     |
| IT Administrator   | 70 (everything except `role.manage`, `settings.edit`, `activity_log.view`) |
| IT Technician      | 36                                                                         |
| Auditor            | 18                                                                         |
| Department Manager | 11                                                                         |
| Employee           | 9                                                                          |

The seed grants a **system** role its catalogue permissions when the role is first created. After that it only
adds permissions that are _new to the catalogue_, so changes made on the Users & roles screen survive redeploys.
Super Admin always holds every permission and cannot be edited. Custom roles are never touched by the seed.
