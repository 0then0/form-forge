# Changelog

All notable user-visible changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions match
[GitHub releases](https://github.com/0then0/form-forge/releases), where each
release also includes detailed upgrade instructions.

## [Unreleased]

### Added

- Visitor opt-in local saving for hosted and embedded forms, with seven-day
  expiry, exact-version Resume/Discard, visible storage errors and tab conflicts,
  and recovery of a frozen submission attempt after a lost server response.
- Manually started GitHub Actions workflows for Neon database migrations and
  Netlify production deploys.
- Contribution guide, security policy, code of conduct, issue and pull request
  templates, and a releasing guide for maintainers.

### Changed

- Docker images and the Netlify build use Node.js 24.22.0. The pinned pnpm
  version is 12.17.0.
- Dependencies updated, including Next.js 16.4.5 and the Sentry SDK.
- Documentation rewritten for new users and operators.

### Fixed

- `pnpm db:migrate` closes its connection on network errors, limits connection,
  lock and statement waits, and reports failures without printing SQL or
  credentials. It does not retry automatically and keeps the existing migration
  history.

### Security

- Removed vulnerable transitive versions of glob, minimatch and esbuild
  ([GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249),
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)).
  None of the affected code paths were reachable in production.

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
