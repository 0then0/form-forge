# Deployment and operations

[Project overview](../README.md) · [Documentation](../README.md#documentation)

For Netlify hosting with Neon PostgreSQL and Inngest Cloud, follow the
[Netlify deployment guide](../deploy/NETLIFY.md). The repository includes the Netlify
build configuration and platform-specific trusted client IP handling.

For a reproducible single-host installation, use the
[Docker Compose installation, upgrade and recovery guide](../deploy/README.md).
It builds from source for your public hostname and runs a real self-hosted
Inngest with persistent scheduler storage. See the
[verification and limitations](../deploy/VERIFICATION.md); a successful build or
health check alone does not establish delivery or production readiness.

Use [the production environment template](../apps/web/.env.production.example) as a checklist, not as deployable credentials. Supply real secrets through your deployment's secret store. `pnpm start` rejects local Inngest mode, known credential placeholders, non-HTTPS application URLs, mismatched application URLs, disabled proxy trust, and enabled test controls. Build-time CI placeholders remain supported.

Set `APP_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` to the same public HTTPS URL. `NEXT_PUBLIC_APP_URL` must be set **before building**; changing a public environment variable requires a rebuild. Configure the GitHub OAuth callback for that hostname and real Inngest credentials with `INNGEST_DEV=0`. Keep `AUTH_SECRET`, `FINGERPRINT_SECRET`, and the 32-byte base64 `WEBHOOK_ENCRYPTION_KEY` stable across deployments. Losing or changing the encryption key makes existing endpoint secrets unreadable.

For self-hosted deployments, the application must be reachable only through a trusted HTTPS ingress. Do not expose its origin port publicly. The ingress must discard any incoming `X-Form-Forge-Client-IP` and replace it with the actual client IP, not append to it. For an Nginx ingress directly facing clients, the relevant setting is `proxy_set_header X-Form-Forge-Client-IP $remote_addr;`. If another trusted proxy precedes Nginx, configure its trusted-address chain before using `$remote_addr`. Also enforce request-body sizes, read timeouts, connection limits, and request limits at ingress; application quotas do not replace network-level protection. On Netlify, the platform provides the trusted ingress and its own client IP header; see the Netlify guide for configuration and platform limits.

Before updating an existing installation, back up the database and secrets, archive any endpoints exceeding the five-per-form cap, stop application writes and workers, then run `pnpm db:migrate`. Migration `0005` is additive and initializes today's reservations from existing submissions and their endpoint snapshots. Build with the target public URL, start with `pnpm start`, register `/api/inngest`, and confirm that all three functions, including the five-minute recovery job, are active before resuming traffic. Keep migrations out of per-instance startup. Roll back application code only to a version compatible with the applied schema; do not delete migration history or drop tables to roll back.

For Docker Compose installations, use the [three-store backup procedure](../deploy/README.md#backup-and-isolated-restore), including scheduler storage and keys. For other hosting environments, use PostgreSQL backups appropriate to the installation. The following commands cover only the application database:

```sh
pg_dump --format=custom --file=form-forge.dump "$DATABASE_URL"
createdb form_forge_restore
pg_restore --dbname=form_forge_restore --no-owner form-forge.dump
```

Run restore rehearsals on an isolated PostgreSQL instance, never over the live database. Restrict and encrypt backup storage because dumps contain personal data. Restore the corresponding secret-store keys too, and verify published schemas, submission counts, and endpoint-secret decryption before relying on a backup. Schedule backups and test restores, rather than treating a successful dump as proof of recovery.

The recovery job logs a warning and sends a Sentry warning when outbox tasks or deliveries are overdue by more than 15 minutes. Scheduled future retries are not flagged. Configure `SENTRY_DSN` and an alert for this warning and unhandled server errors; diagnostics contain counts rather than submission values. Monitor failed or missing Inngest cron runs as well: a stopped scheduler cannot report its own backlog. Start by measuring queue age and throughput; the current dispatcher sends up to 50 outbox events per five-minute run.
