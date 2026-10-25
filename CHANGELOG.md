# Changelog

User-visible changes are recorded here. Versions correspond to
[GitHub releases](https://github.com/0then0/form-forge/releases); detailed upgrade
instructions accompany each release. Unreleased changes are not part of the latest
tagged source archive.

## [Unreleased]

### Added

- Manual GitHub Actions workflow for Neon migrations with a separate database
  secret, and a separate manual Netlify production build trigger.
- Repository contribution and security policies, community templates, editor
  settings and Git file handling conventions.

### Fixed

- Migration command handles transport errors, limits connection and SQL waits,
  closes connections and reports errors without printing SQL or credentials.
  It preserves existing Drizzle migrations and history and does not retry
  automatically. Remote migration execution can bypass a failing local network
  path; the cause of local Neon `ETIMEDOUT` failures remains unconfirmed.

## [0.2.0] - 2026-10-18

### Added

- Immediate outbox dispatch after commit, retaining leases, atomic persistence
  and five-minute recovery scheduling.
- Live intake controls: pause, closing time, lifetime acceptance limit and closed
  message across all published versions.
- Optional source metadata, disabled by default for new forms; owner-confirmed
  response deletion with concurrency protection and limited idempotency markers.
- Server-side response filters, matching CSV export, selectable columns and
  independent new/processed status.
- Automatic iframe height and ready/submitted events; OpenAPI and read-only MCP.
- Dependabot configuration, monthly dependency review and focused documentation.

### Compatibility

Migration `0006_product_controls` preserves metadata collection on existing forms
and initializes acceptance counts. Deletion does not restore quota or form places.
Once the new policies are used, a code-only downgrade is unsupported. See the
[0.2.0 release notes](https://github.com/0then0/form-forge/releases/tag/v0.2.0)
for maintenance and rollback requirements.

## [0.1.0] - 2026-10-18

### Added

- First stable release with versioned schemas, hosted forms, workspace roles,
  signed webhooks, transactional outbox, retry diagnostics and recovery.
- GitHub, Google and GitLab sign-in with explicit account linking.
- Archive inspection, restoration and confirmed permanent form deletion.
- Shared validation, conditional fields, editor improvements and checkbox links.
- Source-built Docker Compose deployment and Netlify/Neon/Inngest Cloud guidance.

See the [0.1.0 release notes](https://github.com/0then0/form-forge/releases/tag/v0.1.0)
for upgrade limitations and the earlier release candidates.

[Unreleased]: https://github.com/0then0/form-forge/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/0then0/form-forge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/0then0/form-forge/releases/tag/v0.1.0
