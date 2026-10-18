# Development

[Project overview](../README.md) · [Documentation](../README.md#documentation)

## Commands

```sh
pnpm dev           # Start the development application
pnpm build         # Build the application and check workspace packages
pnpm typecheck     # Check TypeScript across the workspace
pnpm lint          # Run Biome lint checks
pnpm format:check  # Check Biome and Markdown/YAML formatting
pnpm format        # Format code with Biome and Markdown/YAML with Prettier
pnpm knip          # Check unused code and dependencies
pnpm test          # Run unit tests and configured integration tests
pnpm test:deployment # Test packaging, backup boundaries and cleanup reporting
pnpm test:e2e      # Run the browser lifecycle test
pnpm test:production # Smoke-test the built application on port 3100
pnpm start         # Start the built application with validated production config
pnpm db:generate   # Generate migrations after database schema changes
pnpm db:migrate    # Apply committed migrations
pnpm db:studio     # Open Drizzle Studio
```

Database commands require `DATABASE_URL` in the shell. Biome formats and lints JavaScript, TypeScript, JSON, and CSS. Prettier formats Markdown and YAML. TypeScript 7.0.2 checks types through the native compiler CLI, including during `next build`. Biome enables Promise checks, but these rules are experimental and do not guarantee identical coverage to typescript-eslint. Lefthook checks staged code with Biome and formats staged Markdown and YAML with Prettier; it does not run tests.

## Continuous integration

[GitHub Actions](../.github/workflows/ci.yml) runs on pull requests and pushes to `main`. It installs locked dependencies, applies migrations to an empty PostgreSQL database, checks formatting, types, lint, and unused code, and runs unit tests, PostgreSQL integration tests, deployment utility regressions, the browser lifecycle test, a production build, and a smoke test using `next start`.

The workflow uses PostgreSQL 16 with separate application, integration, and e2e databases. Application keys are generated for each run; OAuth and Inngest values are test placeholders. No repository secrets or external accounts are required. Browser reports and available screenshots and traces are retained for seven days, including failed attempts that pass on retry. Cancelled runs skip diagnostic uploads.

## PostgreSQL integration tests

Without `TEST_DATABASE_URL`, `pnpm test` runs unit tests and skips the PostgreSQL suite. To include integration tests, create a dedicated disposable database:

```sh
createdb form_forge_test
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/form_forge_test'
pnpm test
```

With the Docker container from [Getting started](getting-started.md#2-start-postgresql), replace `createdb` with:

```sh
docker exec form-forge-postgres createdb -U postgres form_forge_test
```

To run only the PostgreSQL suite:

```sh
pnpm --filter @form-forge/web exec vitest run \
  src/integration/pipeline.integration.test.ts
```

The suite applies migrations and checks submission atomicity and idempotency, role permissions, concurrent changes, outbox and lease recovery, webhook failures and retries, endpoint management, and CSV export. External webhook transport is substituted in pipeline tests.

**The integration suite drops and recreates the test database's `public` schema. Never use a development, shared, or production database.** Do not run it concurrently with e2e tests against the same database.

## End-to-end test

Install Chromium once:

```sh
pnpm --filter @form-forge/web exec playwright install chromium
```

Create a separate disposable database and run Playwright:

```sh
createdb form_forge_e2e
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/form_forge_e2e'
pnpm test:e2e
```

For Docker, use `docker exec form-forge-postgres createdb -U postgres form_forge_e2e` instead of `createdb`.

Stop any application already listening on port 3000 before running e2e. Playwright starts its own Next.js development server connected to the test database. It requires a valid application environment, including non-empty GitHub OAuth variables, but does not call GitHub OAuth, Inngest, or an external webhook receiver. It creates a database session for authentication and supplies its own internal pipeline token.

The test covers creating and publishing a form, hosted submission, failure diagnostics, manual retry, successful delivery, and idempotency. Playwright applies migrations and truncates test data before and after the scenario. **Never point it at a database containing data you want to keep.**

To verify the production artifact, use the same disposable database, stop the development server, and run:

```sh
NEXT_PUBLIC_APP_URL=https://forms.example.org pnpm build
pnpm test:production
```

The production smoke test supplies isolated runtime credentials, starts `next start` on port 3100, checks rendering, atomic submission persistence, idempotency and request throttling, and confirms that internal e2e controls are unavailable. It does not call OAuth or cloud Inngest. Its reports are stored under `apps/web/playwright-report/production` and `apps/web/test-results/production`, separately from the lifecycle test. It also migrates and truncates the test database.
