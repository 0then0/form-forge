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
python3 deploy/acceptance/run.py --output deploy/evidence/local.json
```

The runner builds the application and migration images, creates a unique Compose
project with empty volumes and temporary keys, and exercises:

- Runtime production guards, hostname consistency, migration readiness and
  repeatable migrations.
- Private services, ingress client-IP replacement, signed Inngest invocations,
  registration of all three functions and actual completed minute cron runs.
- Atomic submission/outbox persistence during a scheduler outage and normal
  cron recovery after restart.
- Real HTTPS delivery with raw-byte HMAC verification; a 503 followed by a
  scheduled retry across a graceful scheduler restart.
- Lost acknowledgement after application termination, expired lease recovery
  and redelivery under the same logical delivery ID.
- PostgreSQL and Redis restart with retained data, plus application database
  restore into a new destination with matching keys and retained scheduler stores.

The report records source hashes, commit, dirty-checkout state, component versions,
architecture, UTC times, database transitions, receiver metadata and cleanup.
A successful run requires both scenarios and resource cleanup to pass. A failed
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

The automated restore retains matching SQLite and Redis volumes. Rehearse the
[complete three-store backup and restore](README.md#backup-and-isolated-restore)
separately, including pending work. Browser tests use fixture sessions and pipeline
controls. Unit/integration tests cannot replace real scheduler acceptance.

The reference deployment targets one host and at-least-once delivery. Validate
other CPU architectures, future-version upgrades, full scheduler archive restore
and expected capacity in your environment. Graceful restart results do not prove
power-loss durability, point-in-time recovery or high availability. Receivers must
persistently deduplicate logical delivery IDs before performing side effects.
