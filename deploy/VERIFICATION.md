# Verification

Run the repository checks before packaging a release. Use disposable databases
for integration and browser tests; those suites remove fixture data.

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

Database setup and environment requirements are described in the
[root README](../README.md#development-commands). Deployment regression tests
use Python 3.9 or newer and its standard library, temporary Git repositories, and an isolated Docker
build context containing fake secrets. The Docker-context test is skipped when
Docker is unavailable. Receiver tests use temporary TLS certificates and real
HTTPS requests. Neither suite uses installation credentials.

## Real scheduler and transport

```sh
python3 deploy/acceptance/run.py --cold-restore-only --output deploy/evidence/local.json
```

Omit `--cold-restore-only` to also run the existing retained-store restart and
lost-acknowledgement drills. The full cold-restore milestone uses the command above.

The runner builds the application and migration images, creates a unique Compose
project with empty volumes and temporary keys, and exercises:

- Runtime production guards, hostname consistency, migration readiness and
  repeatable migrations.
- Private services, ingress client-IP replacement, signed Inngest invocations,
  registration of all three functions and actual completed minute cron runs.
- Atomic submission/outbox persistence during a scheduler outage and normal
  cron recovery after restart.
- Real HTTPS delivery with raw-byte HMAC verification, a persisted 503 and
  restored retry history/budget. The default extended run also checks graceful
  scheduler restart, lost ACK/lease recovery and retained PostgreSQL/Redis restarts.
- A full maintenance cold
  restore of PostgreSQL, SQLite and Redis into a separate project with three new
  empty volumes, using the real backup script and preserved installation keys.
- Pending outbox, pending retry with retained logical ID/history/budget, completed
  delivery preservation and two additional completed recovery ticks after pending
  work finishes. The shared controlled receiver retains its ordinals/observations.
- Complete backup checksum coverage, corrupted-archive refusal before destination
  startup, and wrong-key decryption refusal before workers.
- Source/destination volume, mount, network, container and database-address isolation;
  full scheduler-directory file hashes, SQLite registration/event/run identities and
  surviving Redis content digests checked before scheduler startup.

The report records source hashes, commit, dirty-checkout state, component versions,
architecture, UTC times, database transitions, receiver metadata and cleanup.
A successful run requires all scenarios and resource cleanup to pass. A failed
run returns a nonzero exit code and retains its report. Images and build cache
remain available; the runner never performs a global Docker prune.

Results are installation-specific artifacts under ignored `deploy/evidence/`.
Do not commit reports, credentials, submission bodies or database dumps. Record
checks as passed, failed or not run; do not substitute test timestamps or generated
IDs for evidence from your own installation.

## Limits

The fixture maps an HTTPS hostname onto an isolated internal Docker network and
trusts its temporary CA only inside the test web container. It verifies the
production transport and target policy, but not public DNS, certificate issuance
or GitHub OAuth. Follow [public installation verification](acceptance/README.md)
on a disposable installation with your own hostname, OAuth app and receiver.

The runner performs the
[complete three-store backup and restore](README.md#backup-and-isolated-restore),
including pending work. It checks the pinned 1.46.0 SQLite schema and Redis
content diagnostically; those internal structures are not a cross-version API.
Redis keys expiring during restore are reported separately. Exact archived files
are compared before Redis starts, so expiration cannot hide an omitted archive.
The retry delay lives in application PostgreSQL/outbox; the drill does not claim
that every application retry corresponds to a restored sleeping Inngest run.
No source containers/volumes are used after backup except the explicitly shared
external receiver fixture. Browser tests use fixture sessions and pipeline
controls. Unit/integration tests cannot replace real scheduler acceptance.

The reference deployment targets one host and at-least-once delivery. Validate
other CPU architectures, future-version upgrades and expected capacity in your environment. Graceful restart results do not prove
power-loss durability, point-in-time recovery or high availability. Receivers must
persistently deduplicate logical delivery IDs before performing side effects.
