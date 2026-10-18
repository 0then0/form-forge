# Form Forge 0.2.0 self-hosting

This is one single-host Docker Compose deployment, built from source for the
installation's public hostname. See [release notes](RELEASE_NOTES.md) for the supported scope and
[verification](VERIFICATION.md) for reproducible checks and their limits.

## Contract and prerequisites

- A dedicated Linux Docker host with Compose v2 or newer, persistent local disk,
  and a public DNS hostname pointing to that host. The reference configuration is verified with Linux arm64 containers.
  Validate other architectures on a disposable host before deployment.
- An owner-managed, publicly trusted TLS certificate and private key for the
  hostname. Renew them outside this stack and reload Nginx after renewal.
- Python 3.9 or newer, OpenSSL, and `shasum` for packaging and backups.
  Automated acceptance also requires curl.
- A GitHub OAuth application and a controlled public HTTPS webhook receiver for
  installation-specific acceptance. The local acceptance fixture requires none
  of these external accounts and does not validate live OAuth.
- Docker registry and package registry access at build/pull time. Production
  startup installs no packages. Dependencies are pinned by `pnpm-lock.yaml` and
  installed with pnpm 12.10.1 and `--frozen-lockfile`.

Runtime images are pinned by tag **and digest** in Compose/Dockerfile: Node
24.21.0 (Debian bookworm slim), PostgreSQL 16.14, Redis 7.4.8, Inngest 1.46.0,
Nginx 1.30.5. Next.js 16.4.0 and Inngest SDK 4.23.0 come from the existing lockfile.
No additional dependency is required.

The application database is `form_forge` in PostgreSQL, with its own credentials
and `application-data` volume. Scheduler configuration and history live in
SQLite under `/var/lib/inngest` in `scheduler-history`. Queue and run state live
in a separate password-protected Redis in `scheduler-queue`, with AOF enabled,
`appendfsync always`, and `noeviction`. The SQLite filesystem boundary replaces
a scheduler database credential; Redis credentials are separate from application
database credentials. Inngest's default in-memory Redis is not used.

This configuration follows the [Inngest self-hosting documentation](https://www.inngest.com/docs/self-hosting)
and the flags verified against [Inngest 1.46.0](https://github.com/inngest/inngest/releases/tag/v1.46.0).
It provides storage across container recreation and measured graceful scheduler
restart. It makes no power-loss, HA, multi-host, or point-in-time recovery claim.
Redis fsync cannot by itself establish a cross-store consistency guarantee.

## Obtain the source

Use a reviewed commit from the [repository](https://github.com/0then0/form-forge)
or a source archive supplied by your release maintainer. Keep the commit ID and
checksums with the installation record; a moving branch does not identify a release.

For a source checkout, replace `<RELEASE_COMMIT>` with the reviewed commit ID:

```sh
git clone https://github.com/0then0/form-forge.git
cd form-forge
git checkout <RELEASE_COMMIT>
```

Continue with **Configure once** below. Local Node.js and pnpm are not required
for the Docker build.

### Install from the source artifact

The artifact contract is `form-forge-0.2.0.tar.gz`, `SOURCE.json`, and
`SHA256SUMS`. `SOURCE.json` records the commit ID and the SHA-256 hash of each
source file. Checksums verify integrity, not publisher identity. Verify and extract
the artifact supplied by your release maintainer:

```sh
shasum -a 256 -c SHA256SUMS
tar -xzf form-forge-0.2.0.tar.gz
cd form-forge-0.2.0
```

Published artifacts are available on the
[GitHub Releases page](https://github.com/0then0/form-forge/releases). Verify all
three files from the same release before extracting the archive.

For maintainers, generate this artifact from a clean, committed checkout with
`python3 deploy/package.py`. It does not commit, create a tag, push, publish an
image, or create a GitHub Release. Re-running it against identical source produces
the same checksums. The packager refuses dirty checkouts and includes only tracked regular files. The application and
workspace npm packages keep their existing internal `0.0.0` versions; the
deployment release version is `deploy/VERSION`.

To publish a reviewed revision, push a tag named `v<deploy/VERSION>`. The
[release workflow](../.github/workflows/release.yml) checks that the tag matches
that version, packages the committed source, verifies checksums, uploads the
three artifacts to a draft GitHub Release, then publishes it. Versions containing
a hyphen, such as `0.2.0-rc.1`, are published as prereleases. The workflow uses
GitHub's scoped job token and requires no registry or personal access credentials.

### Configure once

```sh
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
mkdir -m 700 deploy/tls
```

Edit `deploy/.env`. Set `PUBLIC_HOST` to the bare hostname, such as
`forms.your-domain.org`, without a protocol, port, path or trailing slash. This
deployment supports the HTTPS root origin on port 443. Set a **different** value
for each of `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `AUTH_SECRET`,
`FINGERPRINT_SECRET`, `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, generating each
with `openssl rand -hex 32`. The passwords must be hex to avoid URI escaping
ambiguity. Generate `WEBHOOK_ENCRYPTION_KEY` with `openssl rand -base64 32`.
Copy the resulting values into the file without printing it in logs.

Create a [GitHub OAuth application](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) with:

- Homepage: `https://<PUBLIC_HOST>`.
- Callback: `https://<PUBLIC_HOST>/api/auth/callback/github`.

Set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` to its real client ID and secret.
GitHub is required; Google and GitLab are optional sign-in providers, configured with the credential pairs documented in the root README. Put the TLS certificate chain in
`deploy/tls/fullchain.pem` and its private key in `deploy/tls/privkey.pem`.
Protect these files and the Docker host. Environment values are visible to Docker
administrators; `.env` is an installation secret store, not a multi-tenant vault.

Back up this configuration securely. Keep `AUTH_SECRET`, `FINGERPRINT_SECRET`,
`WEBHOOK_ENCRYPTION_KEY`, and both Inngest keys stable across restarts and upgrades.
Do not regenerate them at startup. Changing the encryption key makes existing
endpoint secrets unreadable; changing the fingerprint key changes rate identities.
Updating PostgreSQL/Redis passwords also requires updating their existing stores,
not just editing `.env` (PostgreSQL initialization only runs on an empty volume).

The build receives only `NEXT_PUBLIC_APP_URL=https://<PUBLIC_HOST>`, never these
secrets. Next.js inlines public configuration at build time. Rebuild for a changed
hostname; this is not a universal image that can be moved between hostnames.
The startup wrapper enforces the same production guard as `next start` and rejects
a runtime URL that differs from the baked URL.

### Build, migrate, start

Use this shell function from the extracted source root for the commands below:

```sh
dc() { docker compose --env-file deploy/.env -f deploy/compose.yaml "$@"; }
dc config --quiet
dc build --no-cache web migrate
dc up -d --wait postgres redis
dc run --rm migrate
dc up -d --wait
dc ps
```

`migrate` is an operations-profile service. It is not started by ordinary `up` and
is not an application entrypoint. It runs the committed Drizzle migrations with
the same locked toolchain. Only one operator should run it at a time. Reapplying
it is safe; do not squash, edit, delete or reset migration history.

Normal stop/start preserves all three named volumes:

```sh
dc stop
dc up -d --wait
```

Do **not** use `down --volumes` on an installation whose data you want to retain.
The application readiness check tests PostgreSQL connectivity, the exact latest
committed migration hash and a rendered HTTP route. It does not prove pipeline
health. Inngest's own healthcheck only proves its HTTP surfaces are responding.

### Verify registration and the five-minute cron

Inngest polls the internal serve URL every 30 seconds. The app uses
`INNGEST_DEV=0`, `INNGEST_BASE_URL=http://inngest:8288`, the matching event/signing
keys, and `INNGEST_SERVE_ORIGIN=http://web:3000`. Incoming invocations retain the
SDK's signature validation. No unauthenticated sync switch is enabled.

Inspect the private scheduler from the web container:

```sh
dc exec -T web node --input-type=module <<'JS'
const query = `{ functions { slug triggers { type value } } stream(query: {limit: 100, includeInternalEvents: true}) { type trigger runs { id status function { slug } startedAt finishedAt } } }`;
const response = await fetch('http://inngest:8288/v0/gql', {
  method: 'POST', headers: {'content-type': 'application/json'},
  body: JSON.stringify({query})
});
console.log(JSON.stringify(await response.json(), null, 2));
JS
```

Require `form-forge-process-submission`, `form-forge-process-webhook-delivery`,
and `form-forge-drain-outbox`, with cron `*/5 * * * *`. Wait for an actual completed
`drain-outbox` run. Registration and a healthy process alone are insufficient.
Do not invoke internal recovery functions manually in an acceptance drill.

Open `https://<PUBLIC_HOST>/login`, sign in through GitHub, publish a small form,
configure your controlled HTTPS endpoint, and submit synthetic data. Verify a
persisted delivery and HMAC over original request bytes at the receiver.
Use the [installation verification procedure](acceptance/README.md) to finish the public
networking and OAuth checks for your installation.

## Network boundary

Only Nginx port 443 is published. There are no host ports for web, PostgreSQL,
Redis, Inngest dashboard/API, metrics, or Connect. The application origin is
accessible to containers on the private stack network and to Docker administrators.
Do not attach untrusted containers or publish those origin ports.

This Nginx directly faces clients and terminates TLS. It **replaces** incoming
`X-Form-Forge-Client-IP` and `X-Forwarded-For` with `$remote_addr`; it does not append
or trust client values. `TRUST_PROXY=1` is preserved. This deployment is not
configured for a CDN or another proxy in front: that requires an explicit trusted
address chain before public use. Do not blindly trust forwarded client headers.

Nginx allows 8,000,000-byte bodies, matching the submission limit. Body upload
timeout is 15 seconds and upstream read/send timeout is 75 seconds. Webhook
transport has its existing 10-second timeout; worker lease is 60 seconds. This
does not impose a new application quota or modify target restrictions. The public
ingress returns 404 for `/api/inngest` and `/api/internal/`; Inngest uses signed
private calls. Authentication and workspace authorization are unchanged.

Access scheduler diagnostics with `dc exec`, or a temporary administrator-only
SSH tunnel and an explicitly loopback-bound port if you need its UI. No permanent
admin port or anonymous public dashboard is part of this deployment. Backlog
warnings only run while the scheduler is running, so also monitor missing cron
runs, disk space and growing history. Error reporting is disabled in this reference
configuration; the existing backlog warning remains in application logs.

The upstream uses Docker's internal DNS resolver and refreshes changed web
container addresses. This supports container recreation during maintenance
without retaining an obsolete origin IP; see the
[Nginx upstream documentation](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve).

## Upgrade and rollback

Before accepting a new artifact, verify its checksum, release limitations and
source provenance. Extract to a new release directory. Copy the existing `.env`
and TLS material securely, without regenerating keys. Keep the same Compose
project name so the same named volumes are used. Build the new `web` and `migrate`
images for the same public hostname before the maintenance window.

1. Schedule downtime, stop ingress/writes and workers, and take the backup below.
2. With PostgreSQL available and workers stopped, run the new `dc run --rm migrate`.
3. Start Redis, application, scheduler and ingress with `dc up -d --wait`.
4. Verify all three functions, an actual completed five-minute cron and a synthetic
   delivery before resuming client traffic. `up --wait` alone is insufficient.

For a same-release recreation drill, `dc stop; dc up -d --force-recreate --wait`
must retain existing data and keys. The automated fixture checks worker restarts,
storage restarts and application recreation during restore; the entire maintenance
upgrade sequence remains an owner-run check. A future-version upgrade cannot be
certified before its schema and release exist. Roll application code back only when it is compatible with the
already applied migrations and scheduler configuration. There are no destructive
down migrations. Otherwise restore a complete backup into a new destination;
do not drop tables or delete history to force a rollback.

## Backup and isolated restore

Backups cover **three stores plus installation keys**. An application `pg_dump`
alone does not capture scheduler queue, run state, configuration or history.
For a controlled maintenance snapshot, with no other database writers:

```sh
sh deploy/backup.sh /absolute/new/form-forge-backup
```

The script stops ingress, web, Inngest and Redis, verifies they are stopped, and creates a PostgreSQL custom dump,
archives the entire stopped SQLite directory (including WAL files) and entire
Redis data directory (including multipart AOF), and copies the installation
environment, release provenance, Compose files, Nginx template and TLS files. Every copied file is covered by the checksum manifest. An `INCOMPLETE` marker remains until dump/archive validation and checksum verification finish; a failed backup must not be restored. The destination must be outside the project directory, including when reached
through a symlink. The script refuses to overwrite a directory and leaves
services stopped for inspection. For an installation with a custom project or
Compose overlay, pass the same standard Compose selectors to the script, for example
`COMPOSE_PROJECT_NAME=my-installation COMPOSE_FILE=deploy/compose.yaml:deploy/local.yaml sh deploy/backup.sh /absolute/new/backup`.
The files must live inside the installation; preserve the backed-up overlays and
review installation-specific addresses and mounts for the destination. Encrypt the entire backup at rest and
move it to restricted storage. Dumps and scheduler history can contain personal
data; never attach them to evidence or release artifacts. Resume with `dc up -d --wait`, then repeat registration/cron checks.

Rehearse restore on a separate Docker project, never over the source. Extract the
**same** source release to a new directory, securely copy `installation.env` to
`deploy/.env` and backup TLS to `deploy/tls`. Bind `HTTPS_BIND=127.0.0.1` and set an
unused `HTTPS_PORT` (for example 19443) so it cannot accept public traffic. Use a
separate function. From the new source root, verify the **entire** backup before
creating a destination. The strengthened checksum/provenance set is produced by
this revised script; original rc.1 backups omit these metadata and TLS coverage
and cannot pass this stricter verification unchanged. `backup_manifest.py verify` refuses an incomplete set,
uncovered/missing files, checksum mismatches and unsafe scheduler archives.
`shasum` alone cannot establish that required files were not omitted.

```sh
python3 deploy/backup_manifest.py verify /backup
(cd /backup && shasum -a 256 -c SHA256SUMS)
restore_dc() { docker compose --env-file deploy/.env -p form-forge-restore -f deploy/compose.yaml "$@"; }
restore_dc config --quiet
restore_dc up -d --wait postgres
restore_dc exec -T postgres pg_restore -U form_forge -d form_forge --no-owner --exit-on-error < /backup/application.dump
restore_dc run --rm --no-deps -T --entrypoint sh inngest -c 'cd /var/lib/inngest && tar -xzf -' < /backup/scheduler-history.tar.gz
restore_dc run --rm --no-deps -T --entrypoint sh redis -c 'cd /data && tar -xzf -' < /backup/scheduler-queue.tar.gz
```

These commands require all three destination volumes to be new and empty and all
writers to be stopped. Refuse a pre-existing project/volume; inspect the resolved
Compose configuration and container mounts to rule out source volume names, bind
mounts, external application/scheduler stores and source service addresses. Stop
the source after backup but retain it until the drill finishes. The disposable
runner verifies this isolation; it shares only the controlled receiver network.
The keys come from `installation.env`; keep `VERSION`, `SOURCE.json`, `BACKUP.json`,
`compose.yaml`, `nginx.conf.template` and `configuration/` with the backup. Match
its source hashes/version with the original source release. For custom overlays,
copy the recorded `configuration/` files and adjust only destination project,
paths and local ingress binding. No migration or fixture SQL repairs scheduler
registration during a same-release restore. Match container ownership and image
versions; do not import a live Redis directory or only SQLite's `main.db` while
its writers are running. Build for the preserved hostname and use local DNS
resolution to reach the loopback HTTPS port. Before workers start, compare published schema IDs/hashes, individual submission
and endpoint identities, outbox states/due times, logical delivery IDs/retry budgets
and attempt history, and verify every endpoint secret decrypts with the preserved
key. A one-off verification process may read the restored database without starting
workers. Refuse decryption failure before allowing delivery processing. Inspect the
restored scheduler directories/history before starting Inngest; application outbox
recovery is not evidence that scheduler archives were restored.

Then run `restore_dc up -d --wait`, verify the same registered function identities,
new completed five-minute cron runs, and real HTTPS delivery under restored logical IDs.
A due retry may already be overdue: application cron dispatches the stored outbox
and repairs due deliveries, rather than preserving a future Inngest sleep for each
application retry.
Do not resume a restore against real receiver endpoints without an agreed
redelivery window; use an owner-controlled isolated receiver for drills.

The automated test runs this complete cold restore using `deploy/backup.sh` in a
disposable installation and a second Compose project. One snapshot contains pending
outbox, a persisted 503 with pending retry, and completed delivery history. It checks
new empty stores, full restored scheduler-directory file hashes, SQLite identities
and history, surviving Redis values before workers, application invariants and
secret decryption. Corrupted archive and wrong-key copies must fail before workers.
It then requires real cron recovery and raw-byte HTTPS HMAC validation and observes
completed logical work across two additional completed recovery ticks. This finite
observation is not a guarantee of no HTTP replay forever.

Application outbox recovery also repairs incomplete processing: pending/failed
events retry; sent submissions without deliveries can be requeued after five
minutes; expired 60-second worker leases are recovered by the five-minute cron. Outbox
dispatch backs off from one minute to one hour and sends up to 50 events per cron
run. Delivery retry delays are 1 minute, 5 minutes, 30 minutes and 2 hours, within
five initial attempts. Recovery may take several ticks and is not instantaneous.
Using fresh scheduler state can lose history and schedules; it is not equivalent
to restoring a matching snapshot. Do not clear scheduler volumes as a recovery
shortcut or promise a recovery point without measuring it.

Delivery is at-least-once. A restore or lost acknowledgement can repeat HTTP
delivery under the same logical `X-Form-Forge-Id`. Receivers must durably deduplicate
that ID before performing side effects. Restoring an old backup may repeat work
accepted after that backup. No exactly-once network delivery or point-in-time
guarantee is claimed.

## Repeat the automated acceptance

On a disposable Docker host with Python 3.9 or newer, OpenSSL and curl:

```sh
python3 deploy/acceptance/run.py --cold-restore-only --output deploy/evidence/local.json
```

The runner creates a random project and new volumes, builds from locked source,
generates temporary credentials/certificates, migrates an empty database, exercises
real signed Inngest calls and real HTTPS transport, and cleans only its resources
in `finally`. Loopback ports 18443 and 19443 and the fixture subnet must be free. Fixture identities,
schemas and endpoints are inserted directly into the disposable database; this is
not a live OAuth test. No production authentication bypass is introduced.

The receiver address `192.0.3.10` exists only on an `internal: true` Docker network
with no external route. A `.invalid` host is mapped inside the web fixture, and a
temporary CA is trusted only by the test container. No request reaches that public
IP's real-world owner or a third-party webhook service. The production transport
and target policy are unchanged. This proves controlled HTTPS transport, not
public DNS, public CA issuance or installation-owner networking.
