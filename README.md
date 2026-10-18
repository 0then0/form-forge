<img src="apps/web/public/form-forge-mark.svg" alt="Form Forge" width="64" height="64">

# Form Forge

[![Node.js requirement](https://img.shields.io/badge/Node.js-22.22.2%2B%20%2F%2024.15.0%2B%20%2F%2026%2B-339933?logo=nodedotjs&logoColor=white)](package.json)
[![pnpm version](https://img.shields.io/badge/pnpm-12.10.1-F69220?logo=pnpm&logoColor=white)](package.json)
[![CI](https://github.com/0then0/form-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/0then0/form-forge/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/0then0/form-forge)](LICENSE)

Form Forge is a self-hosted, schema-first form platform. Define a form, publish an immutable version, collect responses, and deliver them to signed webhooks with inspectable attempts and retries.

Use the hosted form page, embed a form on your site, or submit responses through the public API. Your PostgreSQL database stores forms, responses and delivery history. Form Forge is free/libre software under Apache 2.0, with no product analytics, advertising trackers or usage reports to the project authors. Optional Sentry reporting is controlled by the deployment owner.

## Features

- **Versioned forms:** schema editor with live preview, conditional fields, immutable published versions, comparison and draft restoration.
- **Flexible collection:** hosted pages, iframe embedding with automatic height, and an idempotent public submission API.
- **Intake controls:** pause/resume, closing time, acceptance limits and custom closed messages across all published versions.
- **Response management:** date and answer search, selectable columns, new/processed status, CSV export and owner-confirmed deletion.
- **Privacy controls:** optional source metadata, disabled by default for new forms; no collection of unfinished responses.
- **Reliable webhooks:** signed payloads, transactional outbox, automatic retries, delivery diagnostics and manual recovery.
- **Workspace access:** owner, editor and viewer roles; GitHub, Google and GitLab sign-in with account linking.
- **Integration contracts:** OpenAPI and read-only MCP tools using existing workspace permissions.

## Quick start

For local development, you need PostgreSQL, a GitHub OAuth application, pnpm **12.10.1**, and a Node.js version supported by [package.json](package.json): 22.22.2+, 24.15.0+, or 26+. See [Getting started](docs/getting-started.md) for the complete setup, including a local PostgreSQL container and OAuth callback URLs.

From the repository root:

```sh
pnpm install
cp apps/web/.env.example apps/web/.env
```

Configure the database URL, application secrets and GitHub OAuth credentials in `apps/web/.env` using the [environment instructions](docs/getting-started.md#3-configure-the-environment). Export the same database URL for migrations, then start the application:

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/form_forge'
pnpm db:migrate
pnpm dev
```

In another terminal, start the local background-job server:

```sh
npx --ignore-scripts=false inngest-cli@latest dev \
  -u http://localhost:3000/api/inngest
```

Open [localhost:3000](http://localhost:3000), sign in, create a form and publish it. Submit a response on its hosted page and inspect it in **Submissions**. Add a public HTTPS webhook endpoint to try background delivery. The Inngest dashboard is at [localhost:8288](http://localhost:8288).

For production, use the [Docker Compose guide](deploy/README.md) or [Netlify guide](deploy/NETLIFY.md). Local development credentials are not suitable for deployment.

## Documentation

- [Getting started](docs/getting-started.md): requirements, environment, database, OAuth and your first form.
- [User guide](docs/user-guide.md): account linking, roles, archives, intake, privacy and response management.
- [Public API, OpenAPI and MCP](docs/api.md): submission contracts, idempotency, quotas and authenticated integrations.
- [Embedding](docs/embedding.md): iframe setup, automatic height, lifecycle events and cleanup.
- [Webhooks](docs/webhooks.md): signature verification, retries, outbox delivery and recovery.
- [Architecture](docs/architecture.md): workspace packages, data model and project scope.
- [Development](docs/development.md): commands, CI, database tests and Playwright.
- [Dependency maintenance](docs/dependency-maintenance.md): Dependabot schedules, security fixes and monthly reviews.
- [Deployment and operations](docs/operations.md): production configuration, upgrades, backups and monitoring.

## Contributing

Use the [development guide](docs/development.md) to run the checks relevant to your change. Integration and browser tests require disposable databases and remove test data. Keep changes focused and include tests for meaningful behavior changes.

Report bugs and discuss changes through [GitHub Issues](https://github.com/0then0/form-forge/issues).

## License

[Apache License 2.0](LICENSE). Workspace packages are internal and are not published to npm.
