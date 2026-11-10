# Self-hosting with Docker Compose

This guide installs Form Forge on a single Linux host with Docker Compose. The
images are built from source for your public hostname. For managed hosting, see
the [Netlify guide](NETLIFY.md) instead.

The stack contains:

- **nginx:** the only public service. It terminates TLS on port 443.
- **web:** the Next.js application.
- **postgres:** the application database (`form_forge`), stored in the
  `application-data` volume.
- **inngest:** a self-hosted [Inngest](https://www.inngest.com/docs/self-hosting)
  scheduler. Its configuration and history use SQLite in the `scheduler-history`
  volume.
- **redis:** Inngest's queue and run state, password-protected, in the
  `scheduler-queue` volume. It uses AOF persistence with `appendfsync always` and
  the `noeviction` policy.
- **migrate:** a one-off service that applies database migrations.

Images are pinned by tag and digest: Node.js 24.22.0 (Debian bookworm slim),
PostgreSQL 16.14, Redis 7.4.8, Inngest 1.46.0 and Nginx 1.30.5. Application
dependencies are installed from `pnpm-lock.yaml` with pnpm 12.17.0 and
`--frozen-lockfile`; nothing is installed when containers start.

This is a single-host setup. It survives container recreation and graceful
restarts, but does not provide high availability, multi-host operation or
point-in-time recovery, and is not designed to survive power loss without data
loss.

## Requirements

- A dedicated Linux host with Docker and Compose v2, persistent local disk, and a
  public DNS name pointing to it. The reference configuration is tested with
  Linux arm64 containers; test other architectures on a disposable host first.
- A publicly trusted TLS certificate and private key for that name. Renew them
  outside this stack and reload Nginx afterwards.
- Python 3.9 or newer, OpenSSL and `shasum` for backups and source packages, and
  curl for the automated acceptance test.
- A GitHub OAuth application.
- Access to Docker Hub and the npm registry while building.

Node.js and pnpm are not needed on the host.

## 1. Get the source

Use a [release](https://github.com/0then0/form-forge/releases) or a reviewed
commit. Record the commit ID or the release checksums with your installation; a
branch name does not identify a version.

From Git, replace `<RELEASE_COMMIT>` with a release tag or commit ID:

```sh
git clone https://github.com/0then0/form-forge.git
cd form-forge
git checkout <RELEASE_COMMIT>
```

From a release archive, download `form-forge-<version>.tar.gz`, `SOURCE.json` and
`SHA256SUMS` from the same release, then verify and extract:

```sh
shasum -a 256 -c SHA256SUMS
tar -xzf form-forge-<version>.tar.gz
cd form-forge-<version>
```

`SOURCE.json` records the commit ID and the SHA-256 hash of every source file.
Checksums verify integrity, not who published the files.

## 2. Configure

```sh
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
mkdir -m 700 deploy/tls
```

Edit `deploy/.env`:

- `PUBLIC_HOST`: the bare hostname, such as `forms.example.org`, without protocol,
  port, path or trailing slash. The site is served at the root of
  `https://<PUBLIC_HOST>` on port 443.
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `AUTH_SECRET`, `FINGERPRINT_SECRET`,
  `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`: a different value for each,
  generated with `openssl rand -hex 32`. Use hex values for the passwords so they
  need no escaping in connection URLs.
- `WEBHOOK_ENCRYPTION_KEY`: generate with `openssl rand -base64 32`.

Create a
[GitHub OAuth application](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
with the homepage `https://<PUBLIC_HOST>` and the callback
`https://<PUBLIC_HOST>/api/auth/callback/github`, and set `AUTH_GITHUB_ID` and
`AUTH_GITHUB_SECRET`. Google and GitLab sign-in are optional; see
[sign-in methods](../docs/user-guide.md#sign-in-methods-and-account-linking).

Put the certificate chain in `deploy/tls/fullchain.pem` and the private key in
`deploy/tls/privkey.pem`.

Back up `deploy/.env` and the TLS files securely. Keep `AUTH_SECRET`,
`FINGERPRINT_SECRET`, `WEBHOOK_ENCRYPTION_KEY` and both Inngest keys unchanged
across restarts and upgrades:

- changing `WEBHOOK_ENCRYPTION_KEY` makes stored webhook secrets unreadable;
- changing `FINGERPRINT_SECRET` resets rate-limit identities and deletion markers;
- changing a database or Redis password in `.env` does not change it in the
  existing store, because PostgreSQL applies its password only when initializing
  an empty volume.

Docker administrators can read these values; treat the host accordingly.

Only `NEXT_PUBLIC_APP_URL=https://<PUBLIC_HOST>` is passed to the image build;
secrets are not. Because Next.js embeds the public URL at build time, rebuild after
changing the hostname. The container refuses to start if its runtime URL differs
from the URL it was built with.

## 3. Build, migrate and start

Run these commands from the source root. The `dc` function keeps the commands
short:

```sh
dc() { docker compose --env-file deploy/.env -f deploy/compose.yaml "$@"; }
dc config --quiet
dc build --no-cache web migrate
dc up -d --wait postgres redis
dc run --rm migrate
dc up -d --wait
dc ps
```

`migrate` belongs to the `operations` profile, so `dc up` does not start it. It
applies the committed migrations and can be run again safely, but only one
operator should run it at a time. Never edit, squash or delete migration history.

To stop and start the stack while keeping all data:

```sh
dc stop
dc up -d --wait
```

Do **not** run `dc down --volumes` on an installation whose data you want to
keep.

The application's health check confirms the database connection, that the latest
migration is applied and that a page renders. It does not confirm background
delivery; the next step does.

## 4. Verify background jobs

The application registers its functions with the private Inngest service, which
polls `http://web:3000/api/inngest` every 30 seconds. Requests between them are
signed with the Inngest keys.

List the registered functions and recent runs from inside the stack:

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

Confirm that these functions are registered:

- `form-forge-process-submission`
- `form-forge-process-webhook-delivery`
- `form-forge-drain-outbox`, with the cron trigger `*/5 * * * *`

Wait until at least one `drain-outbox` run has completed; a registered function
alone is not enough.

Then open `https://<PUBLIC_HOST>/login`, sign in with GitHub, publish a small
form, add a webhook endpoint you control, and submit test data. Check that the
delivery succeeds and that your receiver can verify its signature. The
[installation checklist](acceptance/README.md) covers TLS, OAuth, networking and
recovery in more detail.

## Network boundary

Only Nginx port 443 is published. PostgreSQL, Redis, the application port and the
Inngest dashboard and API have no host ports and are reachable only from the
private Compose network. Do not attach untrusted containers to that network or
publish those ports.

Nginx faces clients directly. It **replaces** the incoming
`X-Form-Forge-Client-IP` and `X-Forwarded-For` headers with the connecting
address, and the application runs with `TRUST_PROXY=1`. If you put a CDN or
another proxy in front of Nginx, configure a trusted address chain first;
otherwise every client appears to come from the proxy.

Nginx accepts request bodies up to 8,000,000 bytes, matching the submission
limit, with a 15-second body upload timeout and 75-second upstream timeouts. It
returns 404 for `/api/inngest` and `/api/internal/`; Inngest reaches the
application over the private network.

To open the Inngest dashboard, use `dc exec` or a temporary SSH tunnel to a port
bound to loopback. Do not expose the dashboard publicly.

Sentry is not configured in this stack; the delivery backlog warning appears in
the application logs. Because that warning only runs while the scheduler is
running, also monitor for missing cron runs, disk space and history growth.

## Upgrade and rollback

Before upgrading, read the release notes and verify the new release's checksums.

1. Extract the new release into a new directory. Copy `deploy/.env` and
   `deploy/tls/` securely, without regenerating any keys.
2. Keep the same Compose project name so that the existing volumes are used.
3. Build the new images for the same hostname: `dc build --no-cache web migrate`.
4. Schedule downtime, stop the ingress, application and workers, and take a
   [backup](#backup-and-isolated-restore).
5. With PostgreSQL running and workers stopped, run `dc run --rm migrate`.
6. Start everything with `dc up -d --wait`.
7. Before resuming traffic, repeat the checks in
   [Verify background jobs](#4-verify-background-jobs), including a completed cron
   run and a test delivery. `up --wait` alone does not confirm this.

Roll application code back only to a version that is compatible with the applied
migrations. There are no down migrations; otherwise restore a complete backup into
a new installation. Never drop tables or delete migration history to force a
rollback.

## Backup and isolated restore

A complete backup contains **three stores and the installation keys**: the
PostgreSQL database, the Inngest SQLite directory, the Redis data directory, and
the configuration. A `pg_dump` alone does not include the scheduler's queue, runs,
configuration or history.

### Create a backup

Run the backup during a maintenance window, with no other database writers:

```sh
sh deploy/backup.sh /absolute/path/to/new/form-forge-backup
```

The script:

1. stops Nginx, the application, Inngest and Redis, and verifies that they are
   stopped;
2. creates a PostgreSQL custom-format dump;
3. archives the whole SQLite directory, including WAL files, and the whole Redis
   data directory, including multipart AOF files;
4. copies the installation environment, release provenance, Compose files, Nginx
   template and TLS files;
5. writes a checksum manifest covering every file.

The destination must be a new directory outside the source tree, including
through symlinks. An `INCOMPLETE` marker stays in the backup until all files are
validated; never restore a backup that still has it. The script leaves services
stopped; resume with `dc up -d --wait` and repeat the
[background job checks](#4-verify-background-jobs).

If your installation uses a custom project name or additional Compose files, pass
the same standard Compose variables to the script, for example
`COMPOSE_PROJECT_NAME=my-installation COMPOSE_FILE=deploy/compose.yaml:deploy/local.yaml sh deploy/backup.sh /absolute/path/to/backup`.
The extra files must be inside the installation directory and are included in the
backup.

Backups contain secrets and personal data. Encrypt the whole backup at rest and
move it to restricted storage.

### Restore into a separate installation

Rehearse restores in a separate Compose project, never over the source
installation. Backups made with 0.1.0-rc.1 lack the metadata that the
verification step requires.

1. Extract the **same** release into a new directory. Copy
   `installation.env` from the backup to `deploy/.env` and the backup's TLS files to
   `deploy/tls/`.
2. In `deploy/.env`, set `HTTPS_BIND=127.0.0.1` and an unused `HTTPS_PORT`, such as
   `19443`, so the copy cannot receive public traffic.
3. Verify the whole backup before creating anything:

   ```sh
   python3 deploy/backup_manifest.py verify /backup
   (cd /backup && shasum -a 256 -c SHA256SUMS)
   ```

   `backup_manifest.py verify` rejects incomplete backups, missing or uncovered
   files, checksum mismatches and unsafe archive contents. `shasum` alone cannot
   detect a missing file.

4. Restore the three stores into new, empty volumes of a separate project:

   ```sh
   restore_dc() { docker compose --env-file deploy/.env -p form-forge-restore -f deploy/compose.yaml "$@"; }
   restore_dc config --quiet
   restore_dc up -d --wait postgres
   restore_dc exec -T postgres pg_restore -U form_forge -d form_forge --no-owner --exit-on-error < /backup/application.dump
   restore_dc run --rm --no-deps -T --entrypoint sh inngest -c 'cd /var/lib/inngest && tar -xzf -' < /backup/scheduler-history.tar.gz
   restore_dc run --rm --no-deps -T --entrypoint sh redis -c 'cd /data && tar -xzf -' < /backup/scheduler-queue.tar.gz
   ```

5. Before starting workers, check the restored data: published schemas, response
   and endpoint counts, pending outbox events and deliveries, and that every
   webhook endpoint secret decrypts with the restored key. Stop if any secret fails
   to decrypt.
6. Build for the original hostname, resolve it locally to the loopback port, and
   start the stack with `restore_dc up -d --wait`. Confirm the registered
   functions, new completed cron runs and a real HTTPS delivery.

Keep the source installation stopped but intact until the rehearsal is finished.
Check that the restore project uses only its own volumes, mounts and service
addresses. Never copy a Redis directory or SQLite database while their writers are
running. With custom Compose files, use the copies stored in the backup's
`configuration/` directory and change only the project name, paths and local
port binding.

Use a test receiver for restore drills. A restore can resend deliveries that were
already sent, and retries that were due during the outage are sent by the next
recovery run.

### Recovery behavior

The recovery job, which runs every five minutes, repairs interrupted work:

- pending and failed outbox events are retried, backing off from one minute to one
  hour, up to 50 events per run;
- responses whose deliveries were never created are requeued after five minutes;
- deliveries whose 60-second worker lease expired are picked up again.

Webhook retries are spaced 1 minute, 5 minutes, 30 minutes and 2 hours apart,
within five attempts. Recovery can take several runs. Starting with empty
scheduler volumes loses scheduler history and is not equivalent to restoring a
backup; do not clear them as a shortcut.

Delivery is at least once. A restore or a lost acknowledgement can repeat a
delivery with the same `X-Form-Forge-Id`, and restoring an older backup can repeat
work accepted after it was taken. Receivers must store that ID and skip
duplicates before performing side effects.

## Automated acceptance test

To test the whole stack on a disposable Docker host with Python 3.9 or newer,
OpenSSL and curl:

```sh
python3 deploy/acceptance/run.py --cold-restore-only --output deploy/evidence/local.json
```

The test builds the images, creates a separate Compose project with temporary
keys and certificates, and exercises real Inngest and HTTPS delivery, a backup and
a restore into a second project. It removes only the resources it created.
Loopback ports 18443 and 19443 and the test subnet must be free.

The test receiver runs on an isolated internal Docker network, so no requests
leave the host. The test inserts its users and forms directly into its own
database; it does not test GitHub sign-in, public DNS or certificate issuance.
See [Deployment verification](VERIFICATION.md) for the full list of checks.
