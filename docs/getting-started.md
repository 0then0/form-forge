# Getting started

[Project overview](../README.md) · [Documentation](../README.md#documentation)

## Requirements

- Node.js 22 (22.22.2 or newer), 24 (24.15.0 or newer), or 26 and newer, as specified in `package.json`.
- pnpm 12.10.1, as pinned in `package.json`.
- PostgreSQL. The Docker example below uses PostgreSQL 16.
- A GitHub OAuth application for signing in.
- OpenSSL for the HTTPS receiver tests. Deployment utilities also require Python 3.9 or newer
  and Docker; see [deployment verification](../deploy/VERIFICATION.md).

Run the following commands from the repository root unless stated otherwise.

## 1. Install dependencies

```sh
pnpm install
```

## 2. Start PostgreSQL

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

## 3. Configure the environment

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

## 4. Configure GitHub sign-in

Create a GitHub OAuth application with these local URLs:

- Homepage: `http://localhost:3000`
- Authorization callback: `http://localhost:3000/api/auth/callback/github`

Set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in `apps/web/.env` to the application's client ID and client secret. GitHub is required; Google and GitLab can be enabled with their own OAuth credentials, as described in [sign-in methods and account linking](user-guide.md#sign-in-methods-and-account-linking).

## 5. Apply migrations

Drizzle Kit does not load the Next.js environment files. Export the same database URL before running database commands:

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/form_forge'
pnpm db:migrate
```

Replace the URL if your database uses different credentials or a different address.

## 6. Start the application and background jobs

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

Both processes are needed to exercise webhook delivery. See [delivery and recovery](webhooks.md#delivery-and-recovery) for the outbox lifecycle.

## 7. Create your first form

1. Open `/login` and sign in with GitHub. Your first sign-in creates a personal workspace.
2. Create a form, add fields, and check the preview.
3. Publish the form and open its hosted page at `/f/<form-slug>`.
4. Submit a response and inspect it in **Submissions**.
5. To try delivery, configure a webhook before submitting another response. Inspect its attempts in **Deliveries** and background runs in the Inngest dashboard.

Webhook endpoints must use public HTTPS addresses. Localhost and private-network targets are rejected. Forms without configured endpoints can still collect submissions.
