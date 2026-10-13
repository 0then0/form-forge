# 0.1.0-rc.2

Maintenance cold restore and stronger backup verification for the single-host,
source-built deployment.

- Full PostgreSQL, Inngest SQLite and Redis restore into three new empty volumes
  in a separate Compose project, without source storage access.
- Real signed Inngest cron recovery of pending outbox and retry work, preserving
  logical delivery IDs, attempt history and retry budgets.
- Independent scheduler archive, SQLite history and Redis state verification
  before workers start, plus endpoint-secret decryption and HTTPS HMAC checks.
- Corrupted backup and incorrect encryption-key refusal before processing.
- Complete backup checksums covering installation keys, TLS, deployment
  configuration and release provenance; incomplete backups remain marked.
- Streaming checksum calculation and cleanup that preserves pre-existing
  destination stores when restoration is refused.
- Regression tests for backup completeness, isolation, bounded checksum memory,
  scoped cleanup and failure reporting. Python 3.9 remains supported.

Original rc.1 backups omit the new metadata and complete checksum coverage and
cannot pass the stricter verification unchanged. Create a new maintenance backup
with this release to use the strengthened verification procedure.

Application APIs, authentication, dependencies, database schema and at-least-once
delivery semantics are unchanged. The full extended acceptance also verifies
graceful scheduler restart, lost acknowledgement recovery and retained data after
PostgreSQL/Redis restart. Completed delivery is observed over two additional
completed recovery ticks; this is not an exactly-once network delivery guarantee.

The reference configuration is verified with Linux arm64 containers on one host.
Public DNS/TLS and live OAuth require installation verification. This release does
not establish cross-version or cross-architecture restore, abrupt power-loss
recovery, point-in-time recovery, high availability or production capacity.
See [installation](README.md) and [verification](VERIFICATION.md).
