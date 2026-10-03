<img src="apps/web/public/form-forge-mark.svg" alt="Form Forge" width="64" height="64">

# Form Forge

[![Node.js requirement](https://img.shields.io/badge/Node.js-%3E%3D22.12.0-339933?logo=nodedotjs&logoColor=white)](package.json)
[![pnpm version](https://img.shields.io/badge/pnpm-10.33.2-F69220?logo=pnpm&logoColor=white)](package.json)
[![CI](https://github.com/0then0/form-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/0then0/form-forge/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/0then0/form-forge)](LICENSE)

Form Forge is a schema-first, headless form platform. Define a form, publish an immutable version, collect responses, and deliver them to signed webhooks with inspectable attempts and retries.

Form Forge is a self-hosted application, not a drag-and-drop builder or a managed service. Its focus is explicit contracts, versioned data, reliable background delivery, and a usable administration interface.

## Features

- Schema editor with a live preview, validation, and conditional field visibility.
- Short text, long text, email, number, select, checkbox, and date fields.
- Editable drafts, immutable published versions, version comparison, and restoration into a new draft revision.
- Hosted forms and iframe embedding.
- Version-aware, idempotent submissions with UTM and visitor fingerprint metadata.
- Filterable submissions and deliveries, failure diagnostics, and CSV export.
- Signed webhooks, automatic retries, manual recovery, and endpoint management: edit, disable, enable, archive, and rotate secrets.
- Workspace roles: owner, editor, and viewer.
- System, light, and dark themes.

## Getting started

### Requirements

- Node.js 22.12 or newer.
- pnpm 10.33.2, as pinned in `package.json`.
- PostgreSQL. The Docker example below uses PostgreSQL 16.
- A GitHub OAuth application for signing in.

Run the following commands from the repository root unless stated otherwise.

### 1. Install dependencies

```sh
pnpm install
```

### 2. Start PostgreSQL

For a local PostgreSQL installation:

```sh
createdb form_forge
```

Alternatively, start a local Docker container. Port 5432 must be available:

```sh
docker run -d --name form-forge-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=form_forge -p 127.0.0.1:5432:5432 \
  -v form-forge-postgres-data:/var/lib/postgresql/data postgres:16
docker exec form-forge-postgres pg_isready -U postgres
```

Wait until PostgreSQL reports that it is accepting connections. For this container, use `postgresql://postgres:postgres@127.0.0.1:5432/form_forge`.

The named volume preserves data when the container stops. On subsequent runs, use `docker start form-forge-postgres`. These credentials are for local development only.

### 3. Configure the environment

```sh
cp apps/web/.env.example apps/web/.env
```

Set `DATABASE_URL` to match your PostgreSQL installation. Generate a separate value for each of `AUTH_SECRET`, `FINGERPRINT_SECRET`, and `WEBHOOK_ENCRYPTION_KEY` by running this command three times:

```sh
openssl rand -base64 32
```

`WEBHOOK_ENCRYPTION_KEY` must be a base64-encoded key of exactly 32 bytes. Keep this key stable: changing it prevents decryption of existing webhook secrets.

For local development:

- Set `NEXTAUTH_URL`, `APP_URL`, and `NEXT_PUBLIC_APP_URL` to `http://localhost:3000`.
- Keep `INNGEST_DEV=1` and use `local` for `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
- Leave the Sentry DSNs empty to disable error reporting.
- Keep `TRUST_PROXY=0` unless your reverse proxy overwrites `X-Forwarded-For`.
- Use `TEST_DATABASE_URL` only for a separate disposable database, never the application database.

The application validates environment variables at startup. `.env` and `.env.local` are ignored by Git; Next.js reads both, with `.env.local` taking precedence. Keep local configuration in one file to avoid conflicting values. Never commit secrets.

### 4. Configure GitHub sign-in

Create a GitHub OAuth application with these local URLs:

- Homepage: `http://localhost:3000`
- Authorization callback: `http://localhost:3000/api/auth/callback/github`

Set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in `apps/web/.env` to the application's client ID and client secret. GitHub is the only supported sign-in provider.

### 5. Apply migrations

Drizzle Kit does not load the Next.js environment files. Export the same database URL before running database commands:

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/form_forge'
pnpm db:migrate
```

Replace the URL if your database uses different credentials or a different address.

### 6. Start the application and background jobs

Start Next.js:

```sh
pnpm dev
```

Open `http://localhost:3000`. In a second terminal, start the [Inngest Dev Server](https://www.inngest.com/docs/local-development):

```sh
npx --ignore-scripts=false inngest-cli@latest dev \
  -u http://localhost:3000/api/inngest
```

This runs the standalone CLI without adding a workspace dependency. Its dashboard is available at `http://localhost:8288`.

Both processes are needed to exercise webhook delivery. Submissions are persisted immediately; background processing is asynchronous and the outbox is dispatched by a job that runs once a minute. Without Inngest, responses remain stored, but background delivery does not run.

### 7. Create your first form

1. Open `/login` and sign in with GitHub. Your first sign-in creates a personal workspace.
2. Create a form, add fields, and check the preview.
3. Publish the form and open its hosted page at `/f/<form-slug>`.
4. Submit a response and inspect it in **Submissions**.
5. To try delivery, configure a webhook before submitting another response. Inspect its attempts in **Deliveries** and background runs in the Inngest dashboard.

Webhook endpoints must use public HTTPS addresses. Localhost and private-network targets are rejected. Forms without configured endpoints can still collect submissions.

## Public API and embedding

Public routes do not require an admin session:

- `GET /api/forms/:slug` returns `{ data: { form, schema, versionId, versionNumber } }` for the current published form.
- `POST /api/forms/:slug/submit` accepts `{ versionId, values, context? }` and requires an `Idempotency-Key` header.
- `/f/:slug` serves the hosted form; `?embed=1` selects the iframe layout. The editor provides a ready-to-copy embed snippet.

### Submit a response

Fetch the published schema first. Use its `versionId` and field keys in the submission. Replace the placeholders below; the form must contain a field with the key `name`:

```sh
curl 'http://localhost:3000/api/forms/<form-slug>'

curl -X POST 'http://localhost:3000/api/forms/<form-slug>/submit' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-response-001' \
  -d '{"versionId":"<version-id>","values":{"name":"Ada"}}'
```

A new submission returns `201` with `{ data: { duplicate: false, status: "accepted", submissionId } }`. Acceptance means the response was stored, not that webhook delivery has completed.

Reuse the same idempotency key when retrying the same response after a network failure. An identical retry returns `200` with `duplicate: true`; reusing the key for different values or a different version returns `409`. Use a new key for each new response.

A previously published version remains valid for submissions from an already-open hosted page, provided the form is still available. A version belonging to another form is rejected. Published schemas are not modified when the draft changes.

Optional `context` supports `visitorId`, `referrer`, and `utm` with the standard `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content` keys. Hosted forms collect metadata automatically when available.

API errors use `{ error: { code, message, requestId, fieldErrors? } }`. Validation errors return `422`; oversized bodies return `413`; throttled submissions return `429` with `Retry-After: 600`.

### Limits

- Submission body: 8,000,000 bytes.
- Idempotency key: 1–200 characters.
- Fields per form or submission: 100.
- Short and long text: 10,000 characters per value; email: 320 characters.
- Combined submitted text: 64,000 characters.
- UTM values: normalized to at most 200 characters each.
- When a fingerprint is available: 20 submissions per form and fingerprint in a rolling 10-minute window.
- CSV export: 10,000 submissions and 500 distinct submitted field keys.

Every incoming submit attempt, including malformed requests, consumes a shared PostgreSQL budget before its JSON body is read: 60 requests per IP per fixed UTC minute. Production requires `TRUST_PROXY=1` and the proxy-only `X-Form-Forge-Client-IP` header. The proxy must overwrite it and prevent direct access to the application. Development may use `X-Forwarded-For` with a trusted proxy; without one, requests share a local-development bucket. The visitor ID is metadata, not an identity for this request budget.

Each workspace may accept 1,000 new submissions and reserve 5,000 new webhook deliveries per UTC day. Reservations share the submission transaction; failed transactions and idempotent replays do not consume the daily budget. Quota failures return `429` with `Retry-After` indicating the time until the window resets. Daily delivery reservations count logical deliveries, not HTTP attempts or manual retries.

A form may have five non-archived webhook endpoints, including disabled endpoints. Archive an endpoint to free a slot. Migration `0005` preserves existing data and initializes the current day's usage. If an existing form exceeds the endpoint cap, archive the excess before applying the migration; the migration stops without deleting endpoints.

CSV export preserves the active form and delivery-status filters. It freezes selected records and display metadata before streaming, so new responses and later status changes do not alter an export in progress. Spreadsheet-formula prefixes are escaped.

## Webhooks

Webhook requests are JSON `POST` requests with an envelope containing `apiVersion`, `id`, `type`, `createdAt`, and `data`. The current event type is `submission.created`; `data` contains the form identity, normalized submission values and UTM metadata, and the form version identity.

Requests include:

```txt
X-Form-Forge-Id: <delivery-id>
X-Form-Forge-Timestamp: <unix-timestamp-seconds>
X-Form-Forge-Signature: v1=<hex-hmac-sha256>
```

Verify the signature with the endpoint secret using HMAC-SHA256 over `<timestamp>.<raw-body>`. Use the original request bytes, not reserialized JSON. Endpoint secrets are shown on creation or rotation and stored encrypted with AES-256-GCM.

Return a `2xx` response to acknowledge delivery. Requests have a 10-second timeout. Retryable failures are retried automatically within an initial budget of five attempts; an authorized manual retry increases the total attempt budget by five. Configuration failures can require correction before retrying. Attempts and errors remain visible in the application.

Delivery is **at-least-once**. Consumers must deduplicate by `X-Form-Forge-Id`, including manual retries of the same delivery. Recovery jobs reclaim expired worker leases and requeue submissions whose delivery creation did not complete. Retry timing is driven by persisted scheduling and the minute-based background job, not immediate execution.

## Workspace access

- **Owner:** all actions, including webhook endpoint and membership management.
- **Editor:** edit and publish forms, restore drafts, view and export submissions, and retry failed deliveries.
- **Viewer:** read-only access to forms, versions, submissions, and deliveries, including CSV export.

Admin operations enforce workspace membership and role permissions on the server. To add a member by email, that person must first sign in to Form Forge; email invitations are not implemented.

## Architecture

The pnpm workspace keeps domain logic, rendering, UI, and infrastructure separate:

- `apps/web`: Next.js App Router, admin and public routes, Auth.js, PostgreSQL, Drizzle migrations, Inngest, and Sentry.
- `packages/form-schema`: domain schemas, DTOs, visibility rules, normalization, and validation. TypeScript and Zod only, without framework or platform runtime dependencies.
- `packages/form-renderer`: headless React Hook Form renderer with replaceable UI adapters.
- `packages/ui`: shared UI primitives without form domain logic.

The frontend uses React 19, Tailwind CSS, Radix UI, TanStack Query for server state, and TanStack Table for tabular views. Editor state stays in React Hook Form and local React state.

Drafts are validated JSONB snapshots. Publishing creates an immutable `form_versions` record, and every submission references its exact version. Submission persistence and outbox creation share one PostgreSQL transaction. Inngest processes the outbox; delivery outcomes and attempt history are database records, not just logs.

## Development commands

```sh
pnpm dev           # Start the development application
pnpm build         # Build the application and check workspace packages
pnpm typecheck     # Check TypeScript across the workspace
pnpm lint          # Run ESLint
pnpm format:check  # Check formatting
pnpm format        # Apply formatting
pnpm knip          # Check unused code and dependencies
pnpm test          # Run unit tests and configured integration tests
pnpm test:e2e      # Run the browser lifecycle test
pnpm test:production # Smoke-test the built application on port 3100
pnpm start         # Start the built application with validated production config
pnpm db:generate   # Generate migrations after database schema changes
pnpm db:migrate    # Apply committed migrations
pnpm db:studio     # Open Drizzle Studio
```

Database commands require `DATABASE_URL` in the shell. Lefthook formats and lints staged source files before commits; it does not run tests.

### Continuous integration

[GitHub Actions](.github/workflows/ci.yml) runs on pull requests and pushes to `main`. It installs locked dependencies, applies migrations to an empty PostgreSQL database, checks formatting, types, lint, and unused code, and runs unit tests, PostgreSQL integration tests, the browser lifecycle test, a production build, and a smoke test using `next start`.

The workflow uses PostgreSQL 16 with separate application, integration, and e2e databases. Application keys are generated for each run; OAuth and Inngest values are test placeholders. No repository secrets or external accounts are required. Browser reports and available screenshots and traces are retained for seven days, including failed attempts that pass on retry. Cancelled runs skip diagnostic uploads.

### PostgreSQL integration tests

Without `TEST_DATABASE_URL`, `pnpm test` runs unit tests and skips the PostgreSQL suite. To include integration tests, create a dedicated disposable database:

```sh
createdb form_forge_test
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/form_forge_test'
pnpm test
```

With the Docker container above, replace `createdb` with:

```sh
docker exec form-forge-postgres createdb -U postgres form_forge_test
```

To run only the PostgreSQL suite:

```sh
pnpm --filter @form-forge/web exec vitest run \
  src/integration/pipeline.integration.test.ts
```

The suite applies migrations and checks submission atomicity and idempotency, role permissions, concurrent changes, outbox and lease recovery, webhook failures and retries, endpoint management, and CSV export. External webhook transport is substituted in pipeline tests.

**The integration suite drops and recreates the test database's `public` schema. Never use a development, shared, or production database.** Do not run it concurrently with e2e tests against the same database.

### End-to-end test

Install Chromium once:

```sh
pnpm --filter @form-forge/web exec playwright install chromium
```

Create a separate disposable database and run Playwright:

```sh
createdb form_forge_e2e
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/form_forge_e2e'
pnpm test:e2e
```

For Docker, use `docker exec form-forge-postgres createdb -U postgres form_forge_e2e` instead of `createdb`.

Stop any application already listening on port 3000 before running e2e. Playwright starts its own Next.js development server connected to the test database. It requires a valid application environment, including non-empty GitHub OAuth variables, but does not call GitHub OAuth, Inngest, or an external webhook receiver. It creates a database session for authentication and supplies its own internal pipeline token.

The test covers creating and publishing a form, hosted submission, failure diagnostics, manual retry, successful delivery, and idempotency. Playwright applies migrations and truncates test data before and after the scenario. **Never point it at a database containing data you want to keep.**

To verify the production artifact, use the same disposable database, stop the development server, and run:

```sh
NEXT_PUBLIC_APP_URL=https://forms.example.org pnpm build
pnpm test:production
```

The production smoke test supplies isolated runtime credentials, starts `next start` on port 3100, checks rendering, atomic submission persistence, idempotency and request throttling, and confirms that internal e2e controls are unavailable. It does not call OAuth or cloud Inngest. Its reports are stored under `apps/web/playwright-report/production` and `apps/web/test-results/production`, separately from the lifecycle test. It also migrates and truncates the test database.

## Deployment and operations

Use [the production environment template](apps/web/.env.production.example) as a checklist, not as deployable credentials. Supply real secrets through your deployment's secret store. `pnpm start` rejects local Inngest mode, known credential placeholders, non-HTTPS application URLs, mismatched application URLs, disabled proxy trust, and enabled test controls. Build-time CI placeholders remain supported.

Set `APP_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` to the same public HTTPS URL. `NEXT_PUBLIC_APP_URL` must be set **before building**; changing a public environment variable requires a rebuild. Configure the GitHub OAuth callback for that hostname and real Inngest credentials with `INNGEST_DEV=0`. Keep `AUTH_SECRET`, `FINGERPRINT_SECRET`, and the 32-byte base64 `WEBHOOK_ENCRYPTION_KEY` stable across deployments. Losing or changing the encryption key makes existing endpoint secrets unreadable.

The application must be reachable only through a trusted HTTPS ingress. Do not expose its origin port publicly. The ingress must discard any incoming `X-Form-Forge-Client-IP` and replace it with the actual client IP, not append to it. For an Nginx ingress directly facing clients, the relevant setting is `proxy_set_header X-Form-Forge-Client-IP $remote_addr;`. If another trusted proxy precedes Nginx, configure its trusted-address chain before using `$remote_addr`. Also enforce request-body sizes, read timeouts, connection limits, and request limits at ingress; application quotas do not replace network-level protection.

Before updating an existing installation, back up the database and secrets, archive any endpoints exceeding the five-per-form cap, stop application writes and workers, then run `pnpm db:migrate`. Migration `0005` is additive and initializes today's reservations from existing submissions and their endpoint snapshots. Build with the target public URL, start with `pnpm start`, register `/api/inngest`, and confirm that all three functions, including the minute-based recovery job, are active before resuming traffic. Keep migrations out of per-instance startup. Roll back application code only to a version compatible with the applied schema; do not delete migration history or drop tables to roll back.

Use PostgreSQL backups appropriate to your hosting environment. For a logical backup and an isolated restore rehearsal:

```sh
pg_dump --format=custom --file=form-forge.dump "$DATABASE_URL"
createdb form_forge_restore
pg_restore --dbname=form_forge_restore --no-owner form-forge.dump
```

Run restore rehearsals on an isolated PostgreSQL instance, never over the live database. Restrict and encrypt backup storage because dumps contain personal data. Restore the corresponding secret-store keys too, and verify published schemas, submission counts, and endpoint-secret decryption before relying on a backup. Schedule backups and test restores, rather than treating a successful dump as proof of recovery.

The recovery job logs a warning and sends a Sentry warning when outbox tasks or deliveries are overdue by more than 15 minutes. Scheduled future retries are not flagged. Configure `SENTRY_DSN` and an alert for this warning and unhandled server errors; diagnostics contain counts rather than submission values. Monitor failed or missing Inngest cron runs as well: a stopped scheduler cannot report its own backlog. Start by measuring queue age and throughput; the current dispatcher sends up to 50 outbox events per minute.

## Scope and limitations

Automated checks cover the form lifecycle, PostgreSQL invariants, and a built application smoke test. They do not certify an installation's networking, live OAuth, cloud Inngest, backup recovery, or capacity. Verify those deployment-specific controls before accepting public traffic.

The application uses GitHub sign-in and iframe embedding. It does not include a visual page builder, custom domains, API-key authentication, email invitations, or an embed SDK. Workspace packages are internal and are not published to npm.

The local Docker credentials and Inngest `local` values are not deployment configuration. Workspace limits bound new logical work, but manual retries still consume resources and stored history grows over time; monitor usage and provision storage for your retention needs.
