# 0.3.0

Form Forge 0.3.0 adds voluntary local saving for unfinished hosted and embedded
forms. Visitors can resume or discard answers for the exact published version,
resolve tab conflicts, and safely retry a submission whose server response was lost.

## Changes since 0.2.0

- Opt-in browser drafts expire seven days after the last save, with a 256 KiB
  record limit and at most ten records. Answers are never saved before consent.
- Frozen submission attempts preserve the original payload and idempotency key.
  Starting a different attempt requires confirmation when the outcome is unknown.
- Storage errors remain visible; browsers may block or partition iframe storage.
  Local storage is not encrypted and does not provide strict cross-tab transactions.
- Updated dependencies, Node.js 24.22.0, documentation and manual workflows for
  Neon migrations and Netlify deployment.
- The migration CLI bounds connection and lock waits and redacts failures.

## Upgrade from 0.2.0

Back up your installation and keys, update the source and rebuild images for your
public hostname following [installation](README.md). No new database migrations,
settings or environment variables are required by this release. Existing
published versions, admission policies, quotas and webhook semantics are preserved.
No deployment or migration is triggered by publishing this release.

Downgrading to 0.2.0 stops local draft recovery; browser copies remain until expiry
or browser-data removal. Preserve backups and keys for installation rollback.

## Verification and limitations

This release passed CI, the unit and PostgreSQL integration tests, the browser
tests, and a production build with a smoke test. A test of a lost server
response confirmed that only one submission and one outbox event were stored and
that quota was used once.

Live OAuth, installation-specific DNS and TLS, production capacity and a full
restore from backup were not tested again for this release; see
[verification](VERIFICATION.md). Release artifacts contain the source, its
provenance and SHA-256 checksums. No prebuilt images are published.
