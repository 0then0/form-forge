# Contributing to Form Forge

Form Forge is a small libre/self-hosted application. Keep changes focused and
prefer existing services, workspace packages and platform APIs over new dependencies
or external infrastructure. Discuss substantial features, dependencies and public
contract changes in an issue before implementing them.

By participating, follow the [Code of conduct](CODE_OF_CONDUCT.md). Report
vulnerabilities through the [security policy](SECURITY.md), not a public bug report.

## Local setup

Follow [Getting started](docs/getting-started.md) for Node.js, the pinned pnpm
version, PostgreSQL, environment variables and OAuth configuration. Use pnpm and
commit intentional manifest changes together with `pnpm-lock.yaml`. Do not commit
credentials, local environment files, database dumps or submission data. Environment
examples must contain placeholders only.

The [development guide](docs/development.md) describes commands, CI and test
databases. `.editorconfig`, Biome and Prettier define formatting. Use `pnpm format`
on your own changes; avoid unrelated formatting or snapshot updates.

## Changes and pull requests

- Search existing issues and PRs before opening a duplicate. Include a minimal
  reproduction for bugs and the user problem for feature requests.
- Work on a branch in your fork and open a focused PR against `main`. Explain
  behavior before and after, compatibility implications and checks actually run.
  Add screenshots for meaningful UI changes, with personal data removed.
- Add regression tests for meaningful behavior. Preserve server-side workspace
  authorization, immutable published schemas and answers, idempotency, transactional
  outbox semantics and compatibility with existing forms.
- Generate additive migrations with `pnpm db:generate`; commit SQL and Drizzle
  metadata together. Do not edit applied migrations or reset migration history.
  Test both empty-database installation and upgrades on disposable local databases.
- Use Conventional Commits in English, such as `fix: preserve submission filters`.
  No CLA is required; contributions are provided under the project's
  [Apache License 2.0](LICENSE).

The sole maintainer may push directly to `main`; external and Dependabot changes
use PRs. This does not waive verification. Follow the
[dependency maintenance policy](docs/dependency-maintenance.md) for toolchain,
major and security updates. Do not merge unreviewed dependency changes just to
clear the update queue.

## Verification

Run checks relevant to the change and report any checks you could not run:

```sh
pnpm format:check
pnpm typecheck
pnpm lint
pnpm knip
pnpm test
pnpm test:deployment
```

For runtime, database or UI changes, also run the applicable PostgreSQL,
Playwright and build checks from [Development](docs/development.md) and
[Deployment verification](deploy/VERIFICATION.md). `pnpm test` skips PostgreSQL
integration tests unless `TEST_DATABASE_URL` is set. Integration and browser
suites delete fixture data: use separate disposable local databases, never a
shared or production database. A successful build alone does not verify a change.

## Automation and releases

The existing [workflows](.github/workflows) have distinct responsibilities:

- **CI** runs on PRs and pushes to `main`, using disposable PostgreSQL and test
  credentials. It checks formatting, types, lint, unused code, tests and builds.
- **Monthly dependency review** opens a review issue; Dependabot opens update PRs.
  Neither automatically merges changes.
- **Database migrations** runs manually from `main`, using the dedicated Neon
  secret. See the [Neon migration guide](deploy/NETLIFY.md). It never runs on push.
- **Deploy production** is a separate manual Netlify build trigger. Success means
  Netlify accepted the request, not that deployment finished.
- **Release** publishes committed source and checksums when a `v*` tag is pushed
  and matches `deploy/VERSION`. A release does not require a PR and does not
  deploy the application or migrate its database.

Maintainers update [CHANGELOG.md](CHANGELOG.md), `deploy/VERSION` and
`deploy/RELEASE_NOTES.md` for a release after checking the intended revision.
Detailed release notes must describe migrations and downgrade limits. Do not
create tags or run production workflows as part of an ordinary contribution.
