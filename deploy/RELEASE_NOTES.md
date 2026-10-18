# 0.2.0

Form Forge 0.2.0 improves response intake, privacy, data management and embedding
while retaining the existing self-hosted PostgreSQL/Inngest architecture.

## Changes since 0.1.0

- Faster webhook delivery: after a response commits, Next.js attempts ingestion of
  its outbox work immediately. Inngest also dispatches newly created deliveries
  immediately. Atomic persistence, stable event IDs, leases, at-least-once delivery
  and the five-minute recovery cron remain. Scheduler outages do not turn a saved
  response into a failed submission.
- Live intake controls: pause/resume, UTC closing time, a lifetime acceptance limit
  and a custom closed message. Controls apply to every published version,
  including already-open tabs. Concurrent submissions cannot claim the same last
  place; successful idempotent retries do not consume another place or quota.
- Optional source metadata is disabled by default for new forms. The server
  enforces the setting for both hosted forms and direct API submissions. Abuse
  counters and idempotency continue without a persistent visitor identifier in
  the response.
- Workspace owners can delete a single response after confirming its full ID.
  Deletion removes its values, metadata, deliveries, attempts, events and outbox
  work while retaining shared webhook endpoints, consumed quotas and form places.
  Busy workers or recovery transactions return a retryable conflict. Audit records
  contain identifiers rather than answer values.
- Server-side UTC date filters, bounded answer-word search using PostgreSQL,
  selectable table columns and matching CSV filters. Independent new/processed
  status can be changed by editors and owners without editing original values
  or their historical version. Viewers remain read-only. CSV retains spreadsheet
  formula protection. Client navigation refreshes cached lists after mutations.
- A small optional embed script adds automatic iframe height using ResizeObserver,
  supports multiple forms and exposes ready/submitted events without answer values.
  Origin, window source and per-frame channel checks isolate messages. Plain iframe
  snippets remain supported; embed checks do not restrict direct public API use.
- OpenAPI 3.1 at `/api/openapi` and read-only, stateless MCP at `/api/admin/mcp`.
  MCP uses existing NextAuth session cookies and workspace permissions; no API keys,
  OAuth authorization server, LLM or external service is introduced.
- Dependabot configuration for weekly grouped patch/minor updates, three-to-seven
  day release cooldowns and separate toolchain updates. A monthly workflow creates
  a major-version/toolchain review issue. Security updates need the repository's
  Dependabot alerts/security-update settings and do not wait for that schedule.
  No workflow automatically approves or merges updates.
- Detailed guides now live in `docs`; the root README focuses on the product,
  quick start and documentation navigation. Reviewed dependency and GitHub Actions
  updates merged after the product changes are included.

GitHub, Google and GitLab remain the supported sign-in methods. Existing published
schemas, answer values, public submission contracts and webhook signatures remain
readable and compatible. No visitor analytics, unfinished-response collection or
mandatory CAPTCHA was added.

## Upgrade from 0.1.0

Back up the application database, installation keys and both scheduler stores
before updating. Stop ingress/writes and workers, build for the installation's
public hostname and apply the committed migrations during maintenance. Do not
apply migrations from an application instance's automatic startup.

This release adds `0006_product_controls`. It preserves metadata collection on
pre-existing forms, defaults future forms to collection off, initializes lifetime
accepted counts from existing responses, adds processing status and deletion-key
markers, and builds a GIN index for answer search. Existing schemas and saved
answers/metadata are not rewritten or silently cleaned. The ordinary transactional
index build can block writes; allow a maintenance window for existing data.

Disabling metadata affects future responses only. Deleting a response does not
return daily quota or free an accepted-response place. For 30 days after deletion,
a form-scoped keyed hash blocks reuse of its idempotency key with `409`; no original
key, values or visitor identity is retained in that marker. After expiry, the key
can create a new response, so clients must stop retries after a deletion conflict.
Keep `FINGERPRINT_SECRET` stable. Backup copies and data already received by
external systems require separate removal; automatic response retention is not
included.

Start the application and register the updated Inngest functions, including the
five-minute recovery job. Immediate dispatch requires a supported Next.js
`after`/`waitUntil` lifecycle; cron remains the fallback. Existing iframe snippets
need no changes. Load `/embed.js` only when automatic height/events are wanted.

A code-only downgrade to 0.1.0 is not supported once the new intake/privacy policy,
deletions or acceptance counters are in use: old code does not enforce those
operational rules or maintain the new state. Use an isolated, complete maintenance
backup restore for rollback and retain the matching keys and scheduler stores.
Do not remove migration history or drop tables to force a downgrade.

## Verification and scope

The source revision used to prepare this release passed GitHub CI on the supported
Node versions, including formatting, types, lint, unused-code checks, PostgreSQL
integration tests, deployment utility regressions, browser lifecycle tests,
production build and production smoke test. Release preparation also runs through
the same required PR checks before tagging.

Regression coverage includes cron/delete ordering at the actual outbox insert,
rollback and successful retry, quota/idempotency races, metadata enforcement,
old-version closure, workspace roles, immutable processing updates, filtered CSV,
client cache refresh and multiple cross-origin iframe height changes.

Live OAuth, public DNS/TLS, Netlify's installed adapter, production capacity and
the full three-store cold-restore acceptance drill are not certified by those
checks. Verify installation-specific paths before accepting public traffic.
Receivers must persistently deduplicate at-least-once webhook deliveries. High
availability, point-in-time recovery and cross-architecture restore remain outside
the verified scope.

Artifacts contain source, a provenance manifest and SHA-256 checksums. Images are
built for the installation's public hostname; no prebuilt image is published.
See [installation](README.md) and [verification](VERIFICATION.md).
