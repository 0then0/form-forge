# Contributing to Form Forge

Thank you for your interest in Form Forge. Bug reports, documentation fixes and
focused improvements are all welcome.

Form Forge is a small self-hosted application, so we prefer existing services,
workspace packages and platform APIs over new dependencies or external
infrastructure. Please open an issue to discuss substantial features, new
dependencies or changes to public contracts before you start working on them.

By participating, you agree to follow the [Code of conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities through the [security policy](SECURITY.md), not in a public
issue.

## Set up your environment

Follow [Getting started](docs/getting-started.md) to install Node.js and pnpm,
start PostgreSQL, configure environment variables and GitHub sign-in. The
[development guide](docs/development.md) describes the available commands, tests
and CI.

- Use pnpm, and commit intended manifest changes together with `pnpm-lock.yaml`.
- Never commit credentials, local environment files, database dumps or response
  data. Example environment files contain placeholders only.
- `.editorconfig`, Biome and Prettier define formatting. Run `pnpm format` on
  your changes and avoid unrelated formatting changes.

## Make a change

- Search existing issues and pull requests first. For bugs, include a minimal
  reproduction; for features, describe the problem you want to solve.
- Work on a branch in your fork and open a focused pull request against `main`.
  Describe the behavior before and after, compatibility implications and the
  checks you ran. Add screenshots for visible UI changes, with personal data
  removed.
- Add regression tests for meaningful behavior. Keep these guarantees intact:
  server-side workspace authorization, immutable published schemas and answers,
  idempotent submissions, the transactional outbox, and compatibility with
  existing forms.
- For database changes, generate a new migration with `pnpm db:generate` and
  commit the SQL and Drizzle metadata together. Never edit an applied migration
  or reset migration history. Test both a fresh installation and an upgrade on
  disposable local databases.
- Write commit messages in English using
  [Conventional Commits](https://www.conventionalcommits.org/), for example
  `fix: preserve submission filters`.

All changes to `main`, including the maintainer's, go through pull requests with
passing CI. Dependency updates follow the
[dependency maintenance policy](docs/dependency-maintenance.md).

## Verify your change

Run the checks relevant to your change and mention any you could not run:

```sh
pnpm format:check
pnpm typecheck
pnpm lint
pnpm knip
pnpm test
pnpm test:deployment
```

For changes to runtime behavior, the database or the UI, also run the PostgreSQL,
Playwright and build checks from [Development](docs/development.md) and
[Deployment verification](deploy/VERIFICATION.md). `pnpm test` skips the
PostgreSQL integration tests unless `TEST_DATABASE_URL` is set. Integration and
browser tests delete their data, so use separate disposable local databases and
never a shared or production database. A successful build alone does not verify a
change.

## Automation

The [GitHub Actions workflows](.github/workflows) are:

- **CI:** runs on every pull request and push to `main` with a disposable
  PostgreSQL database and test credentials. It checks formatting, types, lint and
  unused code, runs all test suites and builds the application.
- **Dependency review:** opens a monthly issue listing major and toolchain
  updates. Dependabot opens update pull requests. Neither merges anything
  automatically.
- **Database migrations** and **Deploy production:** started manually by the
  maintainer for the Netlify installation.
- **Release:** publishes a source release when a version tag is pushed.

See [Releasing](docs/releasing.md) for how releases are made.

## License

There is no contributor license agreement. By submitting a contribution, you
agree that it is provided under the project's [Apache License 2.0](LICENSE).
