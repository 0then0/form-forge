# Deployment and operations

[Project overview](../README.md) · [Documentation](../README.md#documentation)

## Choose a deployment

- **[Docker Compose](../deploy/README.md):** a single-host installation built from
  source. It includes PostgreSQL, a self-hosted Inngest scheduler with persistent
  storage, and an Nginx HTTPS ingress, plus backup and restore scripts.
- **[Netlify](../deploy/NETLIFY.md):** Netlify Functions with Neon PostgreSQL and
  Inngest Cloud. The repository includes the Netlify build configuration.

Both guides end with checks that confirm background delivery works. A successful
build or health check alone does not show that delivery works. See
[Deployment verification](../deploy/VERIFICATION.md) for the automated checks and
their limits.

## Configuration

Use [`apps/web/.env.production.example`](../apps/web/.env.production.example) as a
checklist of variables. Supply real values through your platform's secret store,
never through committed files.

- Set `APP_URL`, `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the same public
  HTTPS URL. `NEXT_PUBLIC_APP_URL` is embedded at build time, so changing it
  requires a rebuild.
- Register the GitHub OAuth callback for that hostname.
- Use real Inngest keys with `INNGEST_DEV=0`.
- Keep `AUTH_SECRET`, `FINGERPRINT_SECRET` and `WEBHOOK_ENCRYPTION_KEY` (a
  base64-encoded 32-byte key) stable across deployments and back them up. If the
  encryption key is lost or changed, stored webhook secrets can no longer be
  decrypted.

`pnpm start` refuses to start with an unsafe production configuration: local
Inngest mode, known placeholder credentials, non-HTTPS or mismatched application
URLs, disabled proxy trust, or enabled test controls. Netlify Functions apply the
same checks.

## Reverse proxy

A self-hosted application must be reachable only through a trusted HTTPS reverse
proxy; do not expose its own port publicly. The proxy must discard any incoming
`X-Form-Forge-Client-IP` header and set it to the real client address, without
appending. For Nginx facing clients directly:

```nginx
proxy_set_header X-Form-Forge-Client-IP $remote_addr;
```

If another proxy or CDN sits in front of Nginx, configure Nginx's trusted address
chain first so that `$remote_addr` is the real client. Also enforce request body
size, read timeouts and connection and request limits at the proxy; application
rate limits do not replace network-level protection. On Netlify, the platform
provides the trusted client IP; see the [Netlify guide](../deploy/NETLIFY.md).

## Upgrades

1. Read the [release notes](https://github.com/0then0/form-forge/releases) for
   migrations, compatibility notes and downgrade limits.
2. Back up the database, scheduler state and installation secrets.
3. Stop incoming writes and background workers.
4. Apply migrations once, from a single operator: `pnpm db:migrate`, the Compose
   `migrate` service or the manual migration workflow. Do not run migrations
   automatically on application start.
5. Build with the public URL, start the application and register `/api/inngest`
   with Inngest.
6. Confirm that all three Inngest functions are registered, including the
   five-minute recovery job, before resuming traffic.

Migrations only add to the schema; there are no down migrations. Roll back
application code only to a version that is compatible with the applied schema.
Otherwise restore a complete backup into a new database. Never delete migration
history or drop tables to force a rollback.

## Backups

For Docker Compose installations, use the
[backup and restore procedure](../deploy/README.md#backup-and-isolated-restore).
It covers the database, the scheduler stores and the installation keys.

On other platforms, use PostgreSQL backups appropriate to the provider. These
commands back up and restore only the application database:

```sh
pg_dump --format=custom --file=form-forge.dump "$DATABASE_URL"
createdb form_forge_restore
pg_restore --dbname=form_forge_restore --no-owner form-forge.dump
```

Rehearse restores on a separate PostgreSQL instance, never over the live
database. Dumps contain personal data: restrict and encrypt backup storage. Keep
the matching secrets with each backup, and after a restore check published
schemas, response counts and that webhook endpoint secrets decrypt. Schedule
backups and test restores regularly; a successful dump alone does not prove that
you can recover.

## Monitoring

The recovery job logs a warning, and reports it to Sentry when `SENTRY_DSN` is
set, if outbox events or deliveries are more than 15 minutes overdue. Scheduled
future retries are not reported. These warnings contain counts, not answers.

Set up alerts for this warning and for unhandled server errors. Also alert on
failed or missing Inngest cron runs: a stopped scheduler cannot report its own
backlog. The recovery job sends at most 50 outbox events per five-minute run;
measure queue age and throughput against your expected volume.

Workspace quotas limit new work, but manual retries still use resources and
stored history grows over time. Monitor database size and plan storage for your
retention needs.
