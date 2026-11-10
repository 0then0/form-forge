# Deployment verification

This page lists the checks to run before a release or deployment and explains
what each one does and does not prove.

## Repository checks

Run these from the repository root. Integration and browser tests delete their
data, so point them at disposable databases only; see
[Development](../docs/development.md) for database setup.

```sh
pnpm format:check
pnpm typecheck
pnpm lint
pnpm knip
pnpm test:deployment
pnpm test
pnpm test:e2e
pnpm build
pnpm test:production
```

`pnpm test:deployment` tests the packaging, backup and acceptance utilities. It
needs Python 3.9 or newer and uses only the standard library, temporary Git
repositories, fake secrets and temporary TLS certificates. The test that builds
the Docker context is skipped when Docker is unavailable. None of these tests use
installation credentials.

## Automated acceptance test

The acceptance runner deploys the real Docker Compose stack on a disposable host:

```sh
python3 deploy/acceptance/run.py --cold-restore-only --output deploy/evidence/local.json
```

Without `--cold-restore-only`, it also runs restart and lost-acknowledgement
drills on the original installation before the backup and restore.

The runner builds the application and migration images, creates a Compose
project with empty volumes and temporary keys, and checks:

- production configuration guards, hostname consistency, migration readiness and
  that migrations can be applied again;
- that only the ingress is public, that the ingress replaces the client IP header,
  that Inngest calls are signed, that all three functions are registered and that
  the five-minute cron job completes;
- that a response and its outbox event are saved together while the scheduler is
  stopped, and are delivered after it restarts;
- real HTTPS delivery with signature verification over the raw request bytes,
  including a `503` response followed by a successful retry;
- in the extended run: graceful scheduler restart, recovery after a worker is
  killed before acknowledging a delivery, and PostgreSQL and Redis restarts;
- a full backup with `deploy/backup.sh` and a restore of PostgreSQL, SQLite and
  Redis into a second project with new, empty volumes and the preserved keys;
- after the restore: pending outbox events and retries keep their delivery IDs,
  history and attempt budgets, completed deliveries are not resent, and two more
  recovery runs complete;
- that the backup checksums cover every file, that a corrupted archive is rejected
  before anything is restored, and that a wrong encryption key is detected before
  workers start;
- that the restored project shares no volumes, mounts, networks, containers or
  database addresses with the source, and that the restored scheduler files,
  SQLite records and Redis contents match the backup.

The JSON report records source hashes, the commit and whether the checkout had
local changes, component versions, architecture, UTC times, database transitions,
receiver metadata and cleanup. The run passes only when every scenario and the
cleanup pass. A failed run exits with a nonzero status and keeps its report.
Images and the build cache are kept; the runner never prunes Docker globally.

Reports are written to `deploy/evidence/`, which Git ignores. Do not commit
reports, credentials, response bodies or database dumps.

### Limits of the automated test

The test receiver uses an HTTPS hostname on an internal Docker network with a
temporary certificate authority that only the test container trusts. This checks
the production HTTPS client and webhook target rules, but not public DNS,
certificate issuance or GitHub sign-in. Complete the
[installation checklist](acceptance/README.md) on a disposable installation with
your own hostname, OAuth app and receiver.

The SQLite and Redis comparisons depend on the internal formats of Inngest 1.46.0
and are diagnostic, not a compatibility guarantee across versions. Retry timing
is stored in the application database; the test does not claim that each pending
retry has a matching restored Inngest run.

The reference deployment runs on one host with at-least-once delivery. Validate
other CPU architectures, upgrades between future versions and your expected load
yourself. Graceful restarts do not prove durability after power loss,
point-in-time recovery or high availability.

## What the application tests cover

Unit, component, PostgreSQL integration and Playwright tests cover the product
behavior. In particular:

- **Intake and privacy:** source metadata collection is enforced by both the
  submission service and the HTTP route; rate-limit counters; two visitors
  competing for the last place; closing a form that visitors already have open.
- **Response deletion:** rollback when deletion conflicts with a worker, including
  a recovery job that has selected due work but not yet inserted its outbox row;
  expiry of deletion markers.
- **Access:** workspace roles and isolation between workspaces.
- **Responses:** list and CSV export consistency, processing status updates that
  never change submitted values, and fresh lists after client-side navigation.
- **Embedding:** origin, window and channel validation, observer cleanup, and
  height changes of several cross-origin iframes through validation errors,
  conditional fields and the success message.
- **OpenAPI and MCP:** session and origin protection, bounded arguments, and that
  the published schemas match the request validators.
- **Upgrades:** applying migrations to a database with data from before the
  intake and privacy controls.

Browser tests use test sessions and a test-only control for scheduling, so they
do not exercise real Inngest transport. Only the acceptance test above, or your
own installation checks, verify real scheduling, Netlify's adapter or an external
receiver.
