# Architecture

[Project overview](../README.md) · [Documentation](../README.md#documentation)

## Repository layout

Form Forge is a pnpm workspace built with Turborepo:

```txt
apps/web/                 Next.js application: admin UI, public forms, API routes
  app/                    App Router pages and route handlers
  src/auth/               Auth.js configuration and request-origin checks
  src/db/                 Drizzle schema and database client
  src/services/           Domain services: forms, submissions, deliveries, outbox
  src/inngest/            Background functions
  src/integration/        Webhook transport, URL policy, secret encryption, DB tests
  drizzle/                Committed SQL migrations
  e2e/                    Playwright tests
  scripts/                Migration, startup and readiness scripts
packages/form-schema/     Form schema, validation and visibility rules
packages/form-renderer/   Headless React Hook Form renderer
packages/ui/              Shared UI primitives
deploy/                   Docker Compose deployment, backups and acceptance tests
docs/                     User and contributor documentation
```

The packages keep domain logic, rendering and UI separate:

- `packages/form-schema` defines schemas, DTOs, visibility rules, normalization and
  validation with TypeScript and Zod only, without framework or platform
  dependencies. The editor, public form and server share it.
- `packages/form-renderer` renders a schema with React Hook Form through
  replaceable UI components.
- `packages/ui` contains UI primitives without form domain logic.

Workspace packages are internal and are not published to npm.

## Technology

- **Application:** Next.js App Router, React 19, Tailwind CSS and Radix UI.
  TanStack Query manages server state and TanStack Table renders tables. Editor
  state lives in React Hook Form and local React state.
- **Authentication:** Auth.js (NextAuth) with GitHub, Google and GitLab.
- **Database:** PostgreSQL through Drizzle ORM and the `pg` driver.
- **Background jobs:** [Inngest](https://www.inngest.com/), self-hosted or Inngest
  Cloud.
- **Error reporting:** optional Sentry, configured by the deployment owner.

## Data flow

Drafts are validated JSONB snapshots. Publishing creates an immutable
`form_versions` record, and every response references the exact version it was
submitted against.

Accepting a response writes the response, quota reservations and an outbox event
in one PostgreSQL transaction. Inngest then processes the outbox and sends
webhooks. Delivery state and attempt history are stored as database records, and
a recovery job repairs work that was interrupted. See [Webhooks](webhooks.md#how-delivery-works).

## Scope

Form Forge supports GitHub, Google and GitLab sign-in, hosted forms, plain iframe
embedding and an automatic-height embed script. It does not include a visual page
builder, custom domains, API-key authentication, email invitations or a
general-purpose embed SDK.

Automated tests cover the form lifecycle, PostgreSQL invariants and a smoke test
of the production build. They do not verify an installation's networking, live
OAuth, Inngest Cloud, backup recovery or capacity; check those for your
deployment before accepting public traffic.
