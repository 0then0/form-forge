# Architecture

[Project overview](../README.md) · [Documentation](../README.md#documentation)

The pnpm workspace keeps domain logic, rendering, UI, and infrastructure separate:

- `apps/web`: Next.js App Router, admin and public routes, Auth.js, PostgreSQL, Drizzle migrations, Inngest, and Sentry.
- `packages/form-schema`: domain schemas, DTOs, visibility rules, normalization, and validation. TypeScript and Zod only, without framework or platform runtime dependencies.
- `packages/form-renderer`: headless React Hook Form renderer with replaceable UI adapters.
- `packages/ui`: shared UI primitives without form domain logic.

The frontend uses React 19, Tailwind CSS, Radix UI, TanStack Query for server state, and TanStack Table for tabular views. Editor state stays in React Hook Form and local React state.

Drafts are validated JSONB snapshots. Publishing creates an immutable `form_versions` record, and every submission references its exact version. Submission persistence and outbox creation share one PostgreSQL transaction. Inngest processes the outbox; delivery outcomes and attempt history are database records, not just logs.

## Scope and limitations

Automated checks cover the form lifecycle, PostgreSQL invariants, and a built application smoke test. They do not certify an installation's networking, live OAuth, cloud Inngest, backup recovery, or capacity. Verify those deployment-specific controls before accepting public traffic.

The application supports GitHub, Google and GitLab sign-in, plain iframe embedding and an automatic-height embed script. It does not include a visual page builder, custom domains, API-key authentication, email invitations, or a general-purpose embed SDK. Workspace packages are internal and are not published to npm.

The local Docker credentials and Inngest `local` values are not deployment configuration. Workspace limits bound new logical work, but manual retries still consume resources and stored history grows over time; monitor usage and provision storage for your retention needs.
