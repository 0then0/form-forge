# Deploy to Netlify with Neon and Inngest Cloud

In this setup, Netlify runs the Next.js application through its automatically
installed OpenNext adapter, [Neon](https://neon.com/) hosts PostgreSQL, GitHub
OAuth provides sign-in, and [Inngest Cloud](https://www.inngest.com/) runs
background delivery and recovery. The Docker Compose stack is not used.

Steps:

1. [Create and migrate the Neon database](#1-create-and-migrate-the-neon-database)
2. [Import the repository into Netlify](#2-import-the-repository-into-netlify)
3. [Set production environment variables](#3-set-production-environment-variables)
4. [Configure GitHub OAuth](#4-configure-github-oauth)
5. [Deploy and sync Inngest](#5-deploy-and-sync-inngest)

## 1. Create and migrate the Neon database

Create a Neon project and database in a region close to your Netlify Functions
region. From **Connect**, copy both connection strings, keeping their SSL
parameters:

- **Pooled** (hostname contains `-pooler`): the application's `DATABASE_URL`.
- **Direct** (no `-pooler`): for running migrations.

In the migration URL, use `sslmode=verify-full` and keep other parameters, such as
`channel_binding=require`. This keeps certificate and hostname verification and
avoids the `pg` driver's warning about `sslmode=require`. Never disable TLS
verification to work around connection problems.

You can run migrations from GitHub Actions or from your computer.

### Option A: GitHub Actions (recommended)

1. In GitHub, open **Settings → Secrets and variables → Actions → New repository
   secret**. Create **`NEON_MIGRATION_DATABASE_URL`** with the **direct** connection
   URL, using `sslmode=verify-full`.
2. Make sure the migrations you want are committed on `main` and CI passes. When
   upgrading an existing installation, back up the database and stop writes and
   workers first; see [Upgrades](../docs/operations.md#upgrades).
3. Open **Actions → Database migrations → Run workflow**, select `main` and run it.
   The workflow applies every committed migration that is not yet recorded in the
   database.
4. Confirm that **Apply committed migrations** succeeded before deploying the
   matching application version.

The [workflow](../.github/workflows/migrate.yml) runs only when started manually
from `main`, never on push, pull requests, releases, Netlify builds or function
start. Runs are serialized; do not run local migrations at the same time. The
database secret is available only to the migration step, after dependencies are
installed from the lockfile with lifecycle scripts disabled. If your Neon project
restricts IP addresses, allow GitHub-hosted runners.

### Option B: from your computer

From the repository root, with Node.js, pnpm and dependencies installed:

```sh
export DATABASE_URL='postgresql://USER:PASSWORD@DIRECT_HOST/DB?sslmode=verify-full&channel_binding=require'
pnpm db:migrate
unset DATABASE_URL
```

The migration command reads `DATABASE_URL` from the shell, not from Next.js
environment files or variables such as `DIRECT_URL`. Pass the direct connection
here. Do not run migrations in the build command or at function start, which can
cause concurrent runs and apply production changes from Deploy Previews.

### Migration behavior

Migrations use the committed Drizzle files and the
`drizzle.__drizzle_migrations` history table. The command limits connection
attempts and lock waits to 15 seconds each and every statement to five minutes;
set `MIGRATION_STATEMENT_TIMEOUT_MS` for a longer planned operation. The GitHub
workflow has a 15-minute overall limit.

On error, the command closes the connection and exits with a nonzero status
without printing SQL, answers or credentials. It does not retry. If the
connection drops, the result can be uncertain, because the `COMMIT`
acknowledgement may have been lost: check the migration history and database
state before running it again. Never insert history rows by hand to hide an error.

See [Neon's Drizzle guide](https://neon.com/docs/guides/drizzle).

## 2. Import the repository into Netlify

Import the Git repository and use these build settings:

- Base directory: repository root (`.`).
- Package directory: `apps/web`, set in the Netlify UI.
- Build command: `pnpm exec turbo run build --filter=@form-forge/web...`.
- Publish directory: `apps/web/.next`.

[`netlify.toml`](../netlify.toml) sets the base directory, build command, publish
directory, Node.js 24.22.0 and frozen pnpm install flags. The `packageManager`
field pins pnpm 12.17.0 through Corepack. Dependency hoisting is enabled only for
the Netlify install, as Netlify recommends for pnpm with Next.js. Do not set
`NODE_ENV=production` for the install, because the build needs development
dependencies.

Keep Netlify's automatic Next.js adapter enabled. You do not need a framework
plugin, Dockerfile, static export, SPA redirect or `pnpm start` command. Do not
pin the Functions runtime to an older Node.js version. Choose a Functions region
close to your Neon database.

See [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/),
[monorepos](https://docs.netlify.com/build/configure-builds/monorepos/) and
[dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/).

### Production deploys

`netlify.toml` sets `ignore = "exit 0"`, so pushes and pull requests do not
trigger builds. Deploys are started manually through a build hook, which bypasses
the ignore command. Keep **Active builds** enabled in Netlify: **Stopped builds**
also disables build hooks.

One-time setup:

1. In Netlify, open **Project configuration → Developer settings → Continuous
   deployment → Build hooks → Add build hook**. Name it `Manual production`,
   choose `main` and save.
2. Copy the URL without adding query parameters. In GitHub, open **Settings →
   Secrets and variables → Actions → New repository secret** and save it as
   **`NETLIFY_BUILD_HOOK`**. Do not commit or share this URL.

To deploy, push to `main`, then open **Actions → Deploy production → Run
workflow**, select `main` and run it. Netlify builds the latest `main` at the time
the build starts, not a fixed commit, so avoid pushing while a deploy you care
about is starting. Runs from other branches are skipped. The workflow does not
check out code, install dependencies or run migrations.

A successful workflow run means that Netlify accepted the request, not that the
deploy succeeded. Check **Netlify → Deploys** for the build result and deployed
commit. Requests are not retried automatically, to avoid duplicate builds; check
Deploys before running the workflow again after a network error. Keep automatic
publishing enabled if successful builds should go live immediately.

Migrations are a separate workflow and are not run by deploys. After changing
background function definitions, [sync Inngest](#5-deploy-and-sync-inngest)
again.

See [ignore commands](https://docs.netlify.com/build/configure-builds/ignore-builds/)
and [build hooks](https://docs.netlify.com/build/configure-builds/build-hooks/).

## 3. Set production environment variables

Choose a permanent public URL, such as `https://PROJECT.netlify.app` or a custom
domain. In Netlify's environment variable settings, add real values, using
[`apps/web/.env.production.example`](../apps/web/.env.production.example) as a
checklist. Make them available to **both Builds and Functions**, with values for
the Production deploy context:

```dotenv
DATABASE_URL=<Neon pooled connection string>
AUTH_SECRET=<random secret of at least 32 characters>
FINGERPRINT_SECRET=<separate random secret of at least 32 characters>
WEBHOOK_ENCRYPTION_KEY=<separate base64-encoded 32-byte key>
AUTH_GITHUB_ID=<GitHub OAuth client ID>
AUTH_GITHUB_SECRET=<GitHub OAuth client secret>
NEXTAUTH_URL=https://forms.example.org
APP_URL=https://forms.example.org
NEXT_PUBLIC_APP_URL=https://forms.example.org
TRUST_PROXY=1
INNGEST_DEV=0
INNGEST_EVENT_KEY=<Inngest production event key>
INNGEST_SIGNING_KEY=<Inngest production signing key>
INNGEST_SERVE_ORIGIN=https://forms.example.org
```

Replace every example URL with your permanent URL. Generate `AUTH_SECRET`,
`FINGERPRINT_SECRET` and `WEBHOOK_ENCRYPTION_KEY` separately:

```sh
openssl rand -base64 32
```

Keep these keys unchanged across deploys and back them up; changing the
encryption key makes stored webhook secrets unreadable. Sentry DSNs are optional.
Leave `INNGEST_BASE_URL` unset for Inngest Cloud. Never set `TEST_DATABASE_URL`
or `E2E_PIPELINE_TOKEN` in a deployed environment.

Do not put secrets in `netlify.toml`: variables set there are available to builds
only, not to Functions. Redeploy after changing environment variables;
`NEXT_PUBLIC_APP_URL` is embedded in the browser bundle at build time.

Netlify sets the reserved `SITE_ID` variable in builds and Functions. Form Forge
uses it to apply Netlify's client IP handling and to enforce the production
configuration checks, since Netlify does not run `next start`. Never set
`SITE_ID` on a self-hosted installation.

On Netlify, with `TRUST_PROXY=1`, the client IP address comes only from the
`x-nf-client-connection-ip` header; client-supplied `X-Form-Forge-Client-IP` and
`X-Forwarded-For` are ignored.

See [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/).

## 4. Configure GitHub OAuth

Create a GitHub OAuth app for your permanent hostname:

- Homepage: `https://forms.example.org`
- Callback: `https://forms.example.org/api/auth/callback/github`

Add its client ID and secret to the Netlify environment variables.

## 5. Deploy and sync Inngest

Deploy once the database is migrated and the environment variables are set. In
the Inngest production dashboard, select **Apps → Sync new app** and enter
`https://forms.example.org/api/inngest`. Make sure site or password protection
does not block Inngest. Inngest signs its requests with `INNGEST_SIGNING_KEY`;
keep the same origin in `INNGEST_SERVE_ORIGIN`.

Sync the app again after deploying changes to background functions; automatic sync
is not configured. The `/api/inngest` route serves all functions, so no separate
Netlify Function or Scheduled Function is needed.

Confirm that three functions are registered and wait for a completed run of the
five-minute cron job:

- `process-submission`
- `process-webhook-delivery`
- `drain-outbox` (`*/5 * * * *`)

Then sign in with GitHub, publish a form and submit a response. Add a webhook
endpoint you control, submit again, and check for a successful delivery attempt
and the matching Inngest runs. A successful build or stored response does not
confirm that background delivery works.

See [Inngest app sync](https://www.inngest.com/docs/platform-and-operations/apps-and-syncs)
and [deploying to Netlify](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/netlify).

## Preview deploys

Deploy Previews and branch deploys need their own configuration: a separate Neon
branch or database, matching application URLs, separate GitHub OAuth credentials
and a separate Inngest environment. Migrate that database explicitly. Never give
previews production database credentials or sync them into production Inngest. A
stable staging hostname is easier to use with OAuth than changing preview URLs.
The repository does not provision preview resources automatically, so a preview
without valid configuration fails to build.

## Limits and backups

Netlify synchronous Functions have a 60-second execution limit and a 6 MB
request and response limit; binary encoding can reduce the usable request size to
about 4.5 MB. Both are below Form Forge's own limits of 8,000,000 bytes per
submission and 16,000,000 bytes per schema, so Netlify can reject large requests
before the application sees them. A route's `maxDuration` setting does not change
Netlify's limits. See
[Functions configuration](https://docs.netlify.com/build/functions/configuration/).

Use Neon's backup and restore features for application data, and keep copies of
your installation keys. Inngest Cloud manages scheduler state. The Docker Compose
backup scripts do not apply to this setup. Delivery is at least once, so
receivers must deduplicate by `X-Form-Forge-Id`.
