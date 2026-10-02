# Form Forge

Form Forge is a schema-first, headless form platform. The MVP provides immutable form versions, hosted and iframe forms, version-aware submissions, workspace roles, signed webhook delivery, visible attempt history, and manual retry.

## Architecture

- `apps/web` owns Next.js, Auth.js, PostgreSQL, Drizzle migrations, admin/public routes, Inngest handlers, and Sentry.
- `packages/form-schema` owns the versioned product schema, DTOs, visibility rules, normalization, and validation. It has no framework or platform runtime dependencies.
- `packages/form-renderer` maps the domain schema to React Hook Form through an adapter interface.
- `packages/ui` owns shadcn-style primitives and no form domain logic.

Draft schemas are validated JSONB snapshots. Publishing creates an immutable `form_versions` row. Every submission references the exact version presented to the respondent.

Submission persistence and an outbox event share one PostgreSQL transaction. Inngest drains the outbox, creates one logical delivery per enabled endpoint, and records every HTTP attempt. Product-visible failures are stored in PostgreSQL rather than relying on logs.

The minute-based recovery job also requeues submissions that were ingested but
did not finish processing within five minutes. Recovery and manual delivery
retries use fresh event IDs; webhook consumers must still tolerate at-least-once
delivery.

## Local development

### Prerequisites

- Node.js 22.12 or newer.
- pnpm 10. The repository currently pins pnpm 10.33.2.
- A running PostgreSQL instance and permission to create a database.
- A GitHub account for the local OAuth application.

### 1. Install dependencies

From the repository root:

```sh
pnpm install
```

### 2. Create the database

Create an empty PostgreSQL database named `form_forge`, or use another name and update `DATABASE_URL` accordingly. For a standard local PostgreSQL installation this may be as simple as:

```sh
createdb form_forge
```

The username, password, host, and port in `DATABASE_URL` must match your local PostgreSQL installation. The credentials in `.env.example` are only an example.

Alternatively, use a local Docker container (port 5432 must be free):

```sh
docker run -d --name form-forge-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=form_forge -p 127.0.0.1:5432:5432 \
  -v form-forge-postgres-data:/var/lib/postgresql/data postgres:16
docker exec form-forge-postgres pg_isready -U postgres
docker exec form-forge-postgres createdb -U postgres form_forge_test
docker exec form-forge-postgres createdb -U postgres form_forge_e2e
```

Use `postgresql://postgres:postgres@127.0.0.1:5432/form_forge` locally.
The named volume preserves database contents when the container stops.
For subsequent runs, use `docker start form-forge-postgres`.

### 3. Configure the environment

```sh
cp apps/web/.env.example apps/web/.env
```

Generate independent values for `AUTH_SECRET`, `FINGERPRINT_SECRET`, and `WEBHOOK_ENCRYPTION_KEY`. Run this command three times and paste a different result into each variable:

```sh
openssl rand -base64 32
```

Both `.env` and `.env.local` are ignored by Git. Next.js reads both, with
`.env.local` taking precedence. Keep local values in one file to avoid stale
overrides. Turbo forwards declared environment variables and includes the web
environment files in its build cache inputs.

For local development:

- Keep `NEXTAUTH_URL`, `APP_URL`, and `NEXT_PUBLIC_APP_URL` set to `http://localhost:3000`.
- Keep `INNGEST_DEV=1`. The Inngest v4 SDK requires this to use the local Dev Server.
- `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` may use the non-secret value `local`; the local Dev Server does not validate cloud keys.
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` may remain empty. Sentry is disabled when they are empty.
- Keep `TRUST_PROXY=0` unless a reverse proxy overwrites `X-Forwarded-For`.
- Do not reuse the example secrets outside local development.

### 4. Configure GitHub OAuth

Create a GitHub OAuth application with:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Copy its client ID and client secret to `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in `apps/web/.env`.

### 5. Apply database migrations

Drizzle Kit runs outside Next.js and does not automatically read the web environment files. Export the same database URL in the terminal before running database commands:

```sh
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/form_forge'
pnpm db:migrate
```

Replace the example URL with the value from your `.env`.

### 6. Start the application

Run Next.js from the repository root:

```sh
pnpm dev
```

The application is available at `http://localhost:3000`. In a second terminal, start the [Inngest Dev Server](https://www.inngest.com/docs/local-development):

```sh
npx --ignore-scripts=false inngest-cli@latest dev \
  -u http://localhost:3000/api/inngest
```

This standalone `npx` command does not add a dependency to the workspace. The Inngest interface is available at `http://localhost:8288`; the registered application endpoint is `http://localhost:3000/api/inngest`.

### 7. Verify the first run

1. Open `http://localhost:3000/login` and sign in with GitHub.
2. The first sign-in creates a user and a personal workspace.
3. Create a form, add at least one field, and publish it.
4. Open the hosted form at `/f/<form-slug>` and submit it.
5. Open `http://localhost:8288` to inspect the submission and delivery functions.

Webhook targets must use a public HTTPS URL. Localhost and private-network targets are intentionally rejected by the webhook URL policy.

## Development commands

```sh
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm format
pnpm format:check
pnpm knip
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

Tests are never part of the pre-commit hook. Lefthook only formats and lints staged source files.

### End-to-end test

Install the Chromium browser once:

```sh
pnpm --filter @form-forge/web exec playwright install chromium
```

The e2e scenario creates its own Auth.js database session and workspace. It
does not call GitHub OAuth, the Inngest Dev Server, or public webhook
receivers. Next.js environment validation still requires non-empty
`AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` values. It also requires a dedicated
disposable PostgreSQL database:

```sh
createdb form_forge_e2e
export TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/form_forge_e2e'
pnpm test:e2e
```

Playwright applies all migrations and truncates this database before and after
the scenario. Never point `TEST_DATABASE_URL` at development or production.
The browser test covers UI create and publish, hosted submit, failure
diagnostics, manual retry, success, and idempotent submission. The integration
suite separately exercises the PostgreSQL outbox and leases, signatures,
injected timeout and HTTP failure results, automatic retries, and manual
recovery. URL resolution and private-address blocking are covered by focused
unit tests; no test sends a webhook to an external service.

### PostgreSQL integration tests

The delivery and submission integration suite is skipped unless it receives a
dedicated disposable database. Turbo passes `TEST_DATABASE_URL` through to the
workspace test task, so the full suite can run with `pnpm test`. Test tasks are
not cached, so PostgreSQL checks are executed on every run. Never point
this variable at the development or production database because the suite drops
and recreates its `public` schema:

```sh
createdb form_forge_test
export TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/form_forge_test'
pnpm test

# Run only the PostgreSQL integration suite:
pnpm --filter @form-forge/web exec vitest run \
  src/integration/pipeline.integration.test.ts
```

The suite applies all Drizzle migrations before testing idempotency,
submission/outbox atomicity, per-form rate limiting, acceptance of older form
versions, RBAC, concurrent publication and owner changes, outbox claims,
poison-event retry limits and sustained dispatch failures, expired delivery
leases, webhook failures, signatures,
automatic and manual retries, recovery from a corrupted endpoint secret,
version restore, endpoint lifecycle, recovery of unprocessed submissions,
manual retry after an ingestion/acknowledgement crash, and safe streaming CSV
export with a fixed selection.

## Public contracts

- `GET /api/forms/:slug` returns the current published schema and version identity.
- `POST /api/forms/:slug/submit` accepts `{ versionId, values, context }` and requires an `Idempotency-Key` header.
- Hosted forms are available at `/f/:slug`; append `?embed=1` for the iframe layout.

A version that was published for a form remains valid for submissions from an
already-open hosted page. A version belonging to another form is rejected.

Webhook requests use a versioned JSON envelope and these headers:

```txt
X-Form-Forge-Id
X-Form-Forge-Timestamp
X-Form-Forge-Signature: v1=<hex hmac-sha256>
```

The signature input is `<timestamp>.<raw-body>`. Endpoint secrets are shown once and stored with AES-256-GCM encryption. Delivery is at-least-once, so webhook consumers must deduplicate requests by `X-Form-Forge-Id`.

Submission throttling uses the client-generated visitor ID by default. Set
`TRUST_PROXY=1` only when the reverse proxy overwrites `X-Forwarded-For`; in
that mode the first forwarded address becomes the submission fingerprint.

CSV exports from the submissions inbox preserve the active form and delivery
status filters and freeze the selected records and display metadata before
streaming. New submissions and later delivery status changes do not alter an
export already in progress.

### Public submission limits

- The request body is limited to 8,000,000 bytes.
- `Idempotency-Key` must contain between 1 and 200 characters.
- A form and submission may contain at most 100 fields.
- Short-text and long-text values are limited to 10,000 characters each; email
  values are limited to 320 characters.
- The combined text content of one submission is limited to 64,000 characters.
- UTM values are normalized to at most 200 characters each.
- When a server or visitor fingerprint is available, a form accepts at most 20
  submissions from that fingerprint in a rolling 10-minute window. A rejected
  request returns `429` with `Retry-After: 600`.

CSV export is limited to 10,000 submissions and 500 distinct submitted field
keys. Exports are streamed and spreadsheet-formula prefixes are escaped.

## Access model

- Owner: all actions, endpoint and membership management.
- Editor: form editing/publishing, submission access/export, and failed delivery retry.
- Viewer: read-only forms, versions, submissions, deliveries, and export.

The API checks membership for every admin operation. UI checks only improve usability and are not an authorization boundary.

## Known MVP boundaries

There is no visual builder, drag-and-drop, GraphQL, separate backend, API key flow, custom domain, or published package release process. Embedding uses an iframe; `packages/embed-sdk` will only be introduced when a real SDK contract is required. Email invitations are not included, so a user must sign in once before an owner can add their email to a workspace.
