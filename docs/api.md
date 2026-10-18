# Public API

[Project overview](../README.md) · [Documentation](../README.md#documentation)

Public routes do not require an admin session:

- `GET /api/forms/:slug` returns `{ data: { form, schema, versionId, versionNumber } }` for the current published form.
- `POST /api/forms/:slug/submit` accepts `{ versionId, values, context? }` and requires an `Idempotency-Key` header.
- `/f/:slug` serves the hosted form; `?embed=1` selects the iframe layout. The editor provides a ready-to-copy embed snippet; see [embedding](embedding.md).

## Submit a response

Fetch the published schema first. Use its `versionId` and field keys in the submission. Replace the placeholders below; the form must contain a field with the key `name`:

```sh
curl 'http://localhost:3000/api/forms/<form-slug>'

curl -X POST 'http://localhost:3000/api/forms/<form-slug>/submit' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-response-001' \
  -d '{"versionId":"<version-id>","values":{"name":"Ada"}}'
```

A new submission returns `201` with `{ data: { duplicate: false, status: "accepted", submissionId } }`. Acceptance means the response was stored, not that webhook delivery has completed.

Reuse the same idempotency key when retrying the same response after a network failure. An identical retry returns `200` with `duplicate: true`; reusing the key for different values or a different version returns `409`. Use a new key for each new response.

A previously published version remains valid for submissions from an already-open hosted page, provided the form is still available. A version belonging to another form is rejected. Published schemas are not modified when the draft changes.

Optional `context` supports `visitorId`, `referrer`, and `utm` with the standard `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content` keys. Collection is controlled by the **Intake and privacy** settings, independently of immutable schemas. New forms default to collection off: the hosted client does not read/create a persistent visitor ID or send optional context, and the server stores no fingerprint, UTM, referrer or user agent even if a direct caller supplies them. Enabling collection preserves the previous hosted collection behavior. Existing forms keep collection enabled when migration `0006` runs; existing schemas and stored answers/metadata are unchanged. Disabling collection does not retroactively erase saved metadata.

Abuse protection uses form-scoped HMAC markers with a rolling ten-minute expiry in the existing PostgreSQL usage store, separate from responses. These contain no IP, visitor ID or submission ID and expire independently of response deletion. The five-minute recovery job removes expired markers; expired rows never count against the budget even before cleanup. The request budget and idempotency do not depend on metadata stored in an answer.

API errors use `{ error: { code, message, requestId, fieldErrors? } }`. Validation errors return `422`; oversized bodies return `413`; throttled submissions return `429` with `Retry-After: 600`.

## Limits

- Submission body: 8,000,000 bytes.
- Idempotency key: 1–200 characters.
- Fields per form or submission: 100.
- Short and long text: 10,000 characters per value; email: 320 characters.
- Combined submitted text: 64,000 characters.
- UTM values: normalized to at most 200 characters each.
- When a trusted address or client visitor ID is available: 20 submissions per form and subject in a rolling 10-minute window, including when optional metadata is disabled.
- CSV export: 10,000 submissions and 500 distinct submitted field keys.

Every incoming submit attempt, including malformed requests, consumes a shared PostgreSQL budget before its JSON body is read: 60 requests per IP per fixed UTC minute. Production requires `TRUST_PROXY=1`. On Netlify (`SITE_ID` set), the application uses the platform's `x-nf-client-connection-ip` header. Self-hosted production requires the proxy-only `X-Form-Forge-Client-IP` header; the proxy must overwrite it and prevent direct access to the application. Development may use `X-Forwarded-For` with a trusted proxy; without one, requests share a local-development bucket. The visitor ID is metadata, not an identity for this request budget.

Each workspace may accept 1,000 new submissions and reserve 5,000 new webhook deliveries per UTC day. Reservations share the submission transaction; failed transactions and idempotent replays do not consume the daily budget. Quota failures return `429` with `Retry-After` indicating the time until the window resets. Daily delivery reservations count logical deliveries, not HTTP attempts or manual retries.

A form may have five non-archived webhook endpoints, including disabled endpoints. Archive an endpoint to free a slot. Migration `0005` preserves existing data and initializes the current day's usage. If an existing form exceeds the endpoint cap, archive the excess before applying the migration; the migration stops without deleting endpoints.

CSV export preserves the active form, delivery status, processing status, date range and answer-word filters. It freezes selected records and display metadata before streaming, so new responses and later status changes do not alter an export in progress. Spreadsheet-formula prefixes are escaped.

## OpenAPI and MCP

`GET /api/openapi` serves an OpenAPI 3.1 JSON document for the public form/submit
contracts and product administration operations in this stage, including draft
publication, intake/privacy policy, filtered responses, CSV, status and deletion.
Schemas for requests/filters come from the same Zod validators as the application.
The document describes the existing NextAuth session cookies and role requirements.
Webhook signatures retain their existing envelope/API version; OAuth callbacks,
Inngest/internal test controls, webhook-endpoint administration, version-history
and membership administration are not included in this product document.

`POST /api/admin/mcp` is a read-only, stateless
[Streamable HTTP MCP endpoint](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
It supports protocol versions `2025-11-25`, `2025-06-18` and `2025-03-26`, with JSON
responses, `initialize`, `ping`, `tools/list`, `tools/call`, and notification
acknowledgements. It has no SSE stream or MCP session store (`GET`/`DELETE` return
`405` after authentication). Each call needs the existing authenticated NextAuth
session cookie. This is intended for session-aware first-party/local integrations;
there is no new API key, OAuth authorization server or anonymous data access.
Clients expecting automatic remote OAuth discovery need a separate future integration.

Send `Content-Type: application/json`, `Accept: application/json, text/event-stream`
and the negotiated `MCP-Protocol-Version` after initialization. The 64 KiB body cap,
origin checks on every method and workspace permissions remain enforced. Available
tools are `list_forms` (up to 100, with a truncation flag), `get_form`,
`list_submissions` (the same bounded cursor/filters as HTTP) and `get_submission`
(bounded history). Arguments include `workspaceSlug` plus the resource ID or filters.
Tools only call existing authorized services; viewers cannot gain write access.
Response values returned to an authorized client are untrusted submitted content.
There are no tools for deletion, publication, delivery, or changing status/policy,
and the application adds no LLM or external service.
