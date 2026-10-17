# 0.1.0

First stable release of Form Forge, a free/libre, Apache 2.0 form platform with
versioned schemas, hosted forms, workspaces, and inspectable webhook delivery.

## Changes since 0.1.0-rc.2

- Google and GitLab sign-in alongside GitHub. Link methods from
  an authenticated account to retain the same user and workspace memberships.
  Matching email addresses never automatically merge accounts.
- Read-only access to archived forms and their published versions, archive
  restoration, and owner-only permanent deletion with name confirmation.
  Deletion refuses active background processing without deadlocking workers.
- Shared client/server validation with immediate field errors, strict number
  input handling, and clearer preview validation messages.
- Optional checkbox agreement links, interactive select-option editing, field
  insertion at every boundary, and clearer version comparisons.
- Collapsed, independently scrollable previews, responsive account/workspace
  navigation, improved dark-mode controls, and reliable theme initialization.
- Direct view/publish actions in the form list, clickable submission rows, and
  separate archive and last-save timestamps.
- Netlify deployment with Neon PostgreSQL and Inngest Cloud, alongside the
  existing source-built Docker Compose installation.
- Recovery/outbox scheduling every five minutes. A new submission and its webhook
  delivery use separate outbox stages, so initial delivery can wait roughly ten
  minutes before additional queue or transport delays.
- Clearer licensing and privacy information: no product analytics, advertising
  trackers, or usage reports to the project authors. Deployment owners control
  optional Sentry error and performance reporting.

## Upgrade

Back up the database, installation keys, and scheduler storage before updating.
No database migrations were added since rc.2; retain the existing migration history.
Configure additional OAuth providers only when both client credentials are ready,
using the callback URLs documented in the root README. GitHub remains required.
Unconfigured sign-in methods remain unavailable.

Register the updated Inngest functions so the recovery job uses the five-minute
schedule. Restoring an archived published form reopens its existing public URL.
Permanent deletion also removes submissions, versions, webhook endpoints,
delivery history, and queued events; audit history and consumed usage remain.

Checkbox links extend the stored schema. Older versions that reject unknown
schema properties cannot read forms containing those links, so a code-only
downgrade is not supported for affected forms. Original rc.1 backups also lack
the stricter backup metadata introduced in rc.2; create a fresh maintenance
backup before relying on the current restore verification.

## Verification and scope

The application revision passed GitHub CI: supported Node-version tests, static
checks, PostgreSQL integration tests, deployment regressions, the browser
lifecycle suite, production build, and production smoke test. The PostgreSQL
integration suite contains 46 passing tests, including competing submission and
endpoint locks, transaction rollback, and successful retry after processing.

This release does not claim that live OAuth, public DNS/TLS, or the full
three-store cold-restore acceptance suite were reverified for this revision.
Verify those installation-specific paths before enabling them in production.
Webhook delivery remains at-least-once; receivers must deduplicate delivery IDs.
High availability, production capacity, point-in-time recovery, and
cross-architecture restore are outside the verified scope.

Artifacts contain source, a provenance manifest, and SHA-256 checksums. Images
are built for the installation's public hostname; no prebuilt image is published.
See [installation](README.md) and [verification](VERIFICATION.md).
