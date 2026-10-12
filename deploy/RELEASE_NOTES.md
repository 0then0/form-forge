# 0.1.0-rc.1

First single-host self-hosting release candidate, built from source for the
installation's HTTPS hostname.

- Locked multi-stage Docker build, non-root standalone runtime, production
  configuration validation and build/runtime hostname consistency.
- Persistent PostgreSQL, independent Drizzle migration service, and application
  readiness checking database connectivity, migration state and HTTP rendering.
- Private self-hosted Inngest with signed SDK calls, minute recovery cron,
  persistent SQLite history and authenticated Redis with AOF enabled.
- HTTPS Nginx ingress with trusted client-IP replacement and private scheduler
  endpoints.
- Reproducible source archives with commit provenance, file hashes and checksums.
- Maintenance backup, isolated restore and disposable scheduler/HTTPS acceptance
  procedures, with regression tests for secret exclusion and failure reporting.

GitHub OAuth, workspace permissions, schema versioning, webhook restrictions and
at-least-once delivery retain their existing contracts. Generic production
configuration supports managed Inngest; self-hosted overrides are supplied by
Compose.

The reference configuration is verified with Linux arm64 containers on one host.
Public DNS/TLS and live OAuth require installation verification. Other CPU
architectures, future-version upgrades, abrupt scheduler termination, power loss,
point-in-time recovery, high availability and capacity require separate validation.
See [installation](README.md) and [verification](VERIFICATION.md).
