# Deploy to Vercel with Neon and Inngest Cloud

Vercel runs Next.js, Neon stores the application PostgreSQL data, and Inngest
Cloud schedules and invokes background functions. GitHub OAuth provides sign-in.
The Docker Compose stack is not used for this deployment.

## 1. Create and migrate the Neon database

Create a Neon project and database in a region close to your Vercel Functions
region. In **Connect**, copy both connection strings, preserving SSL parameters:

- **Pooled** (hostname contains `-pooler`): Vercel's `DATABASE_URL`.
- **Direct** (without `-pooler`): migration commands.

The existing `pg` and Drizzle client supports Neon without another driver.
See [Neon's Drizzle guide](https://neon.com/docs/guides/drizzle).

From the repository root, with the required Node.js/pnpm versions and dependencies
installed, apply the committed migrations:

```sh
export DATABASE_URL='postgresql://USER:PASSWORD@DIRECT_HOST/DB?sslmode=require'
pnpm db:migrate
unset DATABASE_URL
```

Drizzle Kit reads the exported `DATABASE_URL`, not Next.js env files. This config
does not read `DATABASE_URL_UNPOOLED` or `DIRECT_URL`; pass the direct connection
as `DATABASE_URL` for the command. Keep migrations out of Vercel builds and
function startup because preview builds can run concurrently.

For an existing installation, back up and transfer the data and preserve all
installation keys before enabling writes and workers. For later schema updates,
follow the maintenance precautions in the root README.

## 2. Import the repository into Vercel

- Framework: **Next.js**.
- Root Directory: **apps/web**.
- Enable **Include source files outside of the Root Directory in the Build Step**
  to include workspace packages.
- Node.js: **24.x**, at least 24.15.0 as required by `package.json`.
- Keep the default Next.js output directory.
- Choose a Functions region close to Neon in project settings.

`apps/web/vercel.json` pins installation to pnpm 12.10.1 and builds the web app
and its workspace dependencies through Turborepo. Leave dashboard command
overrides unset. Vercel serves Next.js functions directly; no Dockerfile or
`pnpm start` command is needed.
See [Vercel monorepos](https://vercel.com/docs/monorepos/monorepo-faq) and
[package managers](https://vercel.com/docs/package-managers).

## 3. Configure the Production environment

Choose a permanent public URL first: a custom domain or the project's stable
`https://PROJECT.vercel.app` address. Set real values in Vercel before building,
using `apps/web/.env.production.example` as the checklist:

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
```

Replace all three example URLs with the same permanent URL. Generate each of
`AUTH_SECRET`, `FINGERPRINT_SECRET`, and `WEBHOOK_ENCRYPTION_KEY` separately:

```sh
openssl rand -base64 32
```

Keep these keys stable across deployments and securely backed up. Changing
`WEBHOOK_ENCRYPTION_KEY` makes existing webhook secrets unreadable.
`NEXT_PUBLIC_APP_URL` is embedded at build time; changing it requires a rebuild.
Sentry DSNs are optional. Leave `INNGEST_BASE_URL` unset for Inngest Cloud. Do not
set `TEST_DATABASE_URL` or `E2E_PIPELINE_TOKEN` in deployed environments.

Vercel supplies `VERCEL=1`. Ensure system environment variables are exposed to the
build; never set it on self-hosted installations. Turborepo forwards it and
includes it in the build cache key. Vercel builds and server-side database
initialization validate production settings, including on Preview deployments
running production Next.js.

With `TRUST_PROXY=1`, production on Vercel reads `x-vercel-forwarded-for` and
ignores client-provided `X-Form-Forge-Client-IP`. Self-hosted production continues
to require the dedicated ingress header. Do not disable proxy trust to bypass
missing IP errors. See [Vercel request headers](https://vercel.com/docs/headers/request-headers).

## 4. Configure GitHub OAuth

Create a production GitHub OAuth app with the same public hostname:

- Homepage: `https://forms.example.org`.
- Callback: `https://forms.example.org/api/auth/callback/github`.

Enter its client ID and secret in Vercel.

## 5. Connect Inngest Cloud and deploy

Install the official Inngest Vercel integration for this project. It supplies
event/signing keys and syncs `/api/inngest` after deployments. Alternatively, set
the keys yourself and sync `https://forms.example.org/api/inngest` in Inngest.
The route uses Node.js with a 60-second maximum duration. Inngest handles
scheduling; Vercel Cron is not required.

Ensure Deployment Protection allows Inngest to reach the synced endpoint. When
protection is enabled, configure the integration's automation bypass where
supported. Optionally set `INNGEST_SERVE_ORIGIN` to your permanent public origin
to sync that hostname instead of a deployment URL.
See [Inngest on Vercel](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel).

Deploy once environment values and migrations are ready. Confirm three registered
functions in Inngest and an actual completed minute cron:

- `process-submission`.
- `process-webhook-delivery`.
- `drain-outbox` (`* * * * *`).

Sign in through GitHub, publish a form, submit a response, and inspect Submissions.
Configure an owner-controlled public HTTPS webhook, submit again, and verify a
successful attempt in Deliveries and corresponding Inngest runs. A successful
build or stored response alone does not verify background delivery.

## Preview isolation and platform limits

Configure Preview separately: use a separate Neon branch/database, explicitly
migrate it, use matching application URLs and a separate GitHub OAuth app, and
use an isolated Inngest environment. Never copy the production database URL into
Preview. A stable staging hostname is easier to configure for OAuth than changing
deployment URLs. Automatic per-preview provisioning is not configured here.

Vercel Functions limit request payloads to 4.5 MB, below the application limits
(8,000,000 bytes for submissions and 16,000,000 for schemas). Larger requests are
rejected by Vercel before application validation. This deployment cannot preserve
the full self-hosted payload allowance.
See [Vercel Functions limits](https://vercel.com/docs/functions/limitations).

Configure Neon backups/restore for application data and retain installation keys.
Inngest Cloud manages scheduler state and history; Docker Compose backup scripts
do not apply to these services. Delivery remains at-least-once: receivers must
deduplicate `X-Form-Forge-Id`.
