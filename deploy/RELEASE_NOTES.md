# 0.5.0

Editors and owners can mark selected responses from one form on the current
Submissions page as processed. The operation updates processing status and records
audit entries in one transaction. If any selected response is unavailable, the
batch is canceled and the list refreshes with the current filters.

Submissions now has previous and next page controls, and response cursors retain
PostgreSQL timestamp precision. The batch endpoint is documented in OpenAPI.

## Upgrade from 0.4.0

Back up your installation and keys, then update the source and rebuild the images
using the [installation guide](README.md). There are no new database migrations
or environment variables. Version 0.4.0 can still read processing statuses and
audit entries written by this release. Downgrading removes the batch action and
its API endpoint.

## Verification

See [verification](VERIFICATION.md) for the checks and their scope. The release
includes the source archive, its provenance and SHA-256 checksums.
