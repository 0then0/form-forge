# Deploy to Netlify with Neon and Inngest Cloud

Netlify runs Next.js through its automatically installed OpenNext adapter. Neon
stores PostgreSQL data, GitHub OAuth provides sign-in, and Inngest Cloud runs
background delivery and recovery. The Docker Compose stack is not used here.

## 1. Create and migrate the Neon database

Create a Neon project and database close to your Netlify Functions region. Copy
both connection strings from **Connect**, preserving their SSL parameters:

- **Pooled**, with `-pooler` in the hostname: application `DATABASE_URL`.
- **Direct**, without `-pooler`: migration commands.

The existing `pg` and Drizzle client supports Neon without an additional driver.
Use **`sslmode=verify-full`** in the migration URL and preserve other Neon
parameters, including `channel_binding=require` when present. This explicitly
keeps certificate and hostname verification and avoids the `pg` warning about
the future meaning of `sslmode=require`. Do not disable TLS verification to fix
connection timeouts.

### Manual GitHub Actions run (recommended for Neon)

1. In GitHub, open **Settings → Secrets and variables → Actions → New repository
   secret**. Name it **`NEON_MIGRATION_DATABASE_URL`** and store the **direct**
   connection URL, with `sslmode=verify-full`. Netlify's pooled URL remains separate.
2. Ensure the desired migrations are committed on `main` and its CI checks pass.
   Back up the database, stop application writes and pause workers before upgrading
   an existing installation. See [upgrade precautions](../docs/operations.md).
3. Open **Actions → Database migrations → Run workflow**, select **main**, and run
   it. The workflow applies all pending committed migrations from that commit,
   including `0006` if only `0000`–`0005` are recorded. It does not generate SQL or
   apply only one arbitrarily selected migration.
4. Confirm **Apply committed migrations** succeeds before deploying the matching
   application version and resuming writes and workers.

The [workflow](../.github/workflows/migrate.yml) runs only on manual dispatch from
`main`, never on push, PR, release, Netlify build or function startup. Concurrent
workflow runs are serialized. Do not run local migrations at the same time. The
database secret is supplied only to the migration step, after dependencies are
installed with a frozen lockfile and lifecycle scripts disabled. That step runs
Node directly, avoiding pnpm's automatic dependency installation before scripts.
GitHub runners
must have network access to Neon; IP restrictions must allow that path.

This bypasses a failing local network path. A local `read ETIMEDOUT` is not an SQL
migration failure merely because small queries work. The SSL warning and transport
timeout are separate issues; changing `sslmode` does not repair the network path.

### Local alternative

From the repository root, with the required Node.js/pnpm versions and dependencies
installed:

```sh
export DATABASE_URL='postgresql://USER:PASSWORD@DIRECT_HOST/DB?sslmode=verify-full&channel_binding=require'
pnpm db:migrate
unset DATABASE_URL
```

The migration runner reads the exported `DATABASE_URL`, not Next.js env files or variables
named `DIRECT_URL` or `DATABASE_URL_UNPOOLED`. Pass the direct connection as
`DATABASE_URL` for this command. Keep migrations out of build commands and function
startup to avoid concurrent migration runs and accidental production changes from
Deploy Previews. For later updates, follow the [maintenance precautions](../docs/operations.md).
Preserve installation keys and transfer existing data before enabling
writes and workers when moving an existing installation.

The runner uses the existing Drizzle migration files and `drizzle.__drizzle_migrations`
history, including installations initialized through Neon SQL Editor with the
original hashes and timestamps. No history reset, manual recreation of `0006`, or
new migration is needed. Connection attempts are limited to 15 seconds, lock waits
to 15 seconds and each SQL statement to five minutes. For a deliberately longer
maintenance operation, set `MIGRATION_STATEMENT_TIMEOUT_MS` explicitly; the manual
workflow also has a 15-minute overall limit. Errors close the connection and return
a nonzero exit status without printing SQL, answer values or credentials. There
are no automatic retries. After a dropped connection, inspect migration history
and database state before rerunning: losing the `COMMIT` acknowledgement makes
the result uncertain. Do not insert history rows by hand to suppress an error.

See [Neon's Drizzle guide](https://neon.com/docs/guides/drizzle).

## 2. Import the Git repository into Netlify

Use these build settings:

- Base directory: repository root (`.`).
- Package directory: `apps/web`, set in the Netlify UI.
- Build command: `pnpm exec turbo run build --filter=@form-forge/web...`.
- Publish directory: `apps/web/.next`, relative to the base directory.

The root `netlify.toml` supplies the base, build command, publish path, Node.js
24.21.0, and frozen pnpm install flags. The `packageManager` field pins pnpm
12.10.1 through Corepack. Hoisting is enabled only for the Netlify install, as
recommended by Netlify for pnpm/Next.js. Do not set `NODE_ENV=production` during
dependency installation: the build needs development dependencies.

Keep the automatic Next.js/OpenNext adapter enabled. No manually installed
framework plugin, Dockerfile, static export, SPA catch-all redirect, or
`pnpm start` command is needed. Do not override the Node.js Functions runtime to
an older version. Choose a Functions region close to Neon in Netlify settings.

See [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/),
[monorepos](https://docs.netlify.com/build/configure-builds/monorepos/), and
[dependency management](https://docs.netlify.com/build/configure-builds/manage-dependencies/).

## 3. Set the Production environment

Choose a permanent public URL, such as `https://PROJECT.netlify.app` or a custom
domain. In Netlify's environment-variable settings, supply real values using
`apps/web/.env.production.example` as the checklist. Make application variables
available to **both Builds and Functions** (or all scopes), with values specific
to the Production deploy context:

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

Replace every example origin with the same permanent URL. Generate each of
`AUTH_SECRET`, `FINGERPRINT_SECRET`, and `WEBHOOK_ENCRYPTION_KEY` separately:

```sh
openssl rand -base64 32
```

Keep keys stable across deploys and securely backed up. Changing the encryption
key makes existing webhook secrets unreadable. Sentry DSNs are optional. Leave
`INNGEST_BASE_URL` unset for Inngest Cloud. Do not set `TEST_DATABASE_URL` or
`E2E_PIPELINE_TOKEN` in deployed environments.

Do not put secrets in `netlify.toml`: variables declared there are build-only,
not available to Functions. After changing environment values, deploy again.
`NEXT_PUBLIC_APP_URL` is embedded in the browser bundle during compilation.

Netlify provides the reserved `SITE_ID` in both builds and Functions. The app uses
it to select the platform trust boundary and enforce production configuration
without `next start`. Turborepo forwards it and includes it in the cache key.
Do not set `SITE_ID` on a self-hosted installation. The build-only `NETLIFY`
variable is not used to detect the Functions runtime.

Production on Netlify reads only `x-nf-client-connection-ip` with `TRUST_PROXY=1`.
It ignores client-supplied `X-Form-Forge-Client-IP` and `X-Forwarded-For`.
Self-hosted production continues to require the dedicated ingress header.

See [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/)
and [Netlify's client IP header guidance](https://answers.netlify.com/t/is-the-client-ip-header-going-to-be-supported-long-term/11203).

## 4. Configure GitHub OAuth

Create a production GitHub OAuth app using your permanent public hostname:

- Homepage: `https://forms.example.org`.
- Callback: `https://forms.example.org/api/auth/callback/github`.

Enter its client ID and secret in the Netlify environment settings.

## 5. Deploy and sync Inngest

Deploy once database migrations and environment values are ready. In the Inngest
production dashboard, select **Apps > Sync new app** and enter
`https://forms.example.org/api/inngest`. Ensure site/password protection does not
block Inngest requests. Inngest verifies requests using `INNGEST_SIGNING_KEY`.
Keep the same origin in `INNGEST_SERVE_ORIGIN`.

After deploying changes to function definitions, sync the app again. Automatic
sync is not configured: the optional `netlify-plugin-inngest` is not required and
is not installed. This keeps deployment free of extra build dependencies.
The existing `/api/inngest` Node.js route serves the functions; no separate
Netlify function endpoint or Netlify Scheduled Function is needed.

Confirm three functions are registered and observe an actual completed minute
cron run:

- `process-submission`.
- `process-webhook-delivery`.
- `drain-outbox` (`*/5 * * * *`).

Sign in through GitHub, publish a form, submit a response, and inspect Submissions.
Configure an owner-controlled public HTTPS webhook, submit again, and verify a
successful delivery attempt and the corresponding Inngest runs. A successful
build or stored response alone does not verify background delivery.

See [Inngest app sync](https://www.inngest.com/docs/platform-and-operations/apps-and-syncs)
and [Netlify deployment options](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/netlify).

## Preview isolation, limits, and backups

Deploy Previews and branch deploys need isolated configuration: a separate Neon
branch/database, matching application URLs, separate GitHub OAuth credentials,
and an isolated Inngest environment. Explicitly migrate that database. Never let
previews inherit production database credentials or sync them into production
Inngest. A stable staging hostname is easier for OAuth than changing preview URLs.
Automatic per-preview database/environment provisioning is not configured here;
previews without valid configuration intentionally fail the build.

Netlify synchronous Functions have a 60-second execution limit and a 6 MB
buffered request/response limit; binary encoding can reduce the effective request
limit to about 4.5 MB. These are below the app's existing 8,000,000-byte submission
and 16,000,000-byte schema limits. Oversized requests can be rejected by Netlify
before app validation. The self-hosted payload allowance is not preserved here.
The Next.js route's `maxDuration` setting does not configure Netlify limits.
See [Functions configuration](https://docs.netlify.com/build/functions/configuration/).

Use Neon backups/restore for application data and retain installation keys.
Inngest Cloud manages scheduler state/history. Docker Compose backup scripts do
not apply to these managed services. Delivery remains at-least-once; receivers
must deduplicate `X-Form-Forge-Id`.
