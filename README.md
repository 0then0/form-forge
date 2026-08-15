# Form Forge

Form Forge is a schema-first, headless form platform. The MVP provides immutable form versions, hosted and iframe forms, version-aware submissions, workspace roles, signed webhook delivery, visible attempt history, and manual retry.

## Architecture

- `apps/web` owns Next.js, Auth.js, PostgreSQL, Drizzle migrations, admin/public routes, Inngest handlers, and Sentry.
- `packages/form-schema` owns the versioned product schema, DTOs, visibility rules, normalization, and validation. It has no framework or platform runtime dependencies.
- `packages/form-renderer` maps the domain schema to React Hook Form through an adapter interface.
- `packages/ui` owns shadcn-style primitives and no form domain logic.

Draft schemas are validated JSONB snapshots. Publishing creates an immutable `form_versions` row. Every submission references the exact version presented to the respondent.

Submission persistence and an outbox event share one PostgreSQL transaction. Inngest drains the outbox, creates one logical delivery per enabled endpoint, and records every HTTP attempt. Product-visible failures are stored in PostgreSQL rather than relying on logs.

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

### 3. Configure the environment

```sh
cp apps/web/.env.example apps/web/.env.local
```

Generate independent values for `AUTH_SECRET`, `FINGERPRINT_SECRET`, and `WEBHOOK_ENCRYPTION_KEY`. Run this command three times and paste a different result into each variable:

```sh
openssl rand -base64 32
```

For local development:

- Keep `NEXTAUTH_URL`, `APP_URL`, and `NEXT_PUBLIC_APP_URL` set to `http://localhost:3000`.
- Keep `INNGEST_DEV=1`. The Inngest v4 SDK requires this to use the local Dev Server.
- `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` may use the non-secret value `local`; the local Dev Server does not validate cloud keys.
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` may remain empty. Sentry is disabled when they are empty.
- Do not reuse the example secrets outside local development.

### 4. Configure GitHub OAuth

Create a GitHub OAuth application with:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Copy its client ID and client secret to `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in `apps/web/.env.local`.

### 5. Apply database migrations

Drizzle Kit runs outside Next.js and does not automatically read `apps/web/.env.local`. Export the same database URL in the terminal before running database commands:

```sh
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/form_forge'
pnpm db:migrate
```

Replace the example URL with the value from your `.env.local`.

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

The current e2e scenario expects an already published form whose first textbox accepts ordinary text. Pass its slug explicitly:

```sh
E2E_PUBLISHED_FORM_SLUG=<form-slug> pnpm test:e2e
```

Playwright starts the web application automatically unless `PLAYWRIGHT_BASE_URL` points to an already running instance. PostgreSQL, migrations, and the application env file must still be configured.

## Public contracts

- `GET /api/forms/:slug` returns the current published schema and version identity.
- `POST /api/forms/:slug/submit` accepts `{ versionId, values, context }` and requires an `Idempotency-Key` header.
- Hosted forms are available at `/f/:slug`; append `?embed=1` for the iframe layout.

Webhook requests use a versioned JSON envelope and these headers:

```txt
X-Form-Forge-Id
X-Form-Forge-Timestamp
X-Form-Forge-Signature: v1=<hex hmac-sha256>
```

The signature input is `<timestamp>.<raw-body>`. Endpoint secrets are shown once and stored with AES-256-GCM encryption.

## Access model

- Owner: all actions, endpoint and membership management.
- Editor: form editing/publishing, submission access/export, and failed delivery retry.
- Viewer: read-only forms, versions, submissions, deliveries, and export.

The API checks membership for every admin operation. UI checks only improve usability and are not an authorization boundary.

## Known MVP boundaries

There is no visual builder, drag-and-drop, GraphQL, separate backend, API key flow, custom domain, or published package release process. Embedding uses an iframe; `packages/embed-sdk` will only be introduced when a real SDK contract is required. Email invitations are not included, so a user must sign in once before an owner can add their email to a workspace.
