# Public API, OpenAPI and MCP

[Project overview](../README.md) · [Documentation](../README.md#documentation)

## Public endpoints

These routes do not require signing in:

- `GET /api/forms/:slug` returns the current published form:
  `{ data: { form, schema, versionId, versionNumber } }`.
- `POST /api/forms/:slug/submit` accepts `{ versionId, values, context? }` and
  requires an `Idempotency-Key` header.
- `/f/:slug` serves the hosted form page. Add `?embed=1` for the iframe layout;
  see [Embedding](embedding.md).

## Submit a response

Fetch the published schema first, then submit values keyed by its field keys,
together with its `versionId`. In this example, the form has a field with the key
`name`:

```sh
curl 'http://localhost:3000/api/forms/<form-slug>'

curl -X POST 'http://localhost:3000/api/forms/<form-slug>/submit' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-response-001' \
  -d '{"versionId":"<version-id>","values":{"name":"Ada"}}'
```

A new response returns `201` with
`{ data: { duplicate: false, status: "accepted", submissionId } }`. This means
the response was stored; webhook delivery happens afterwards in the background.

### Idempotency

Use a new idempotency key for each new response, and reuse the same key when
retrying that response after a network failure:

- An identical retry returns `200` with `duplicate: true`.
- Reusing a key with different values or a different version returns `409`.
- Replaying the key of a response that an owner deleted returns `409` for 30
  days; see [deleting a response](user-guide.md#deleting-a-response).

### Versions

A submission must reference a version of the same form. Older published versions
remain valid while the form is available, so a page that a visitor opened before
you published a new version can still be submitted. Editing the draft never
changes a published schema.

### Optional context

`context` can include `visitorId`, `referrer` and `utm`, with the standard
`utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content` keys.
The server stores this context only when the form's **Intake and privacy**
settings enable source metadata, which is off by default. See
[privacy and source metadata](user-guide.md#privacy-and-source-metadata).

### Errors

Errors use `{ error: { code, message, requestId, fieldErrors? } }`:

- `409`: idempotency conflict, or a temporary conflict with another operation.
- `413`: the request body is too large.
- `422`: validation failed; `fieldErrors` lists problems by field key.
- `429`: a rate limit or quota was exceeded; `Retry-After` gives the wait in
  seconds.

## Limits

- Submission body: 8,000,000 bytes.
- Idempotency key: 1 to 200 characters.
- Fields per form or submission: 100.
- Short and long text: 10,000 characters per value. Email: 320 characters.
- Combined submitted text: 64,000 characters.
- UTM values: normalized to at most 200 characters each.
- CSV export: 10,000 responses and 500 distinct field keys.

### Rate limits

Every submit request, including malformed ones, counts against a budget of 60
requests per client IP address per UTC minute. This check runs before the request
body is read.

In addition, each form accepts at most 20 responses from the same client in a
rolling ten-minute window; exceeding it returns `429` with `Retry-After: 600`.
The client is identified by its trusted IP address or, when that is unavailable,
by the `visitorId` sent in `context`. This applies even when the form does not collect
source metadata. The limit uses short-lived, keyed markers that contain no IP
address, visitor ID or response ID and are kept separately from responses.

How the client IP address is determined depends on the deployment:

- **Production** requires `TRUST_PROXY=1`.
- **Netlify** (detected by `SITE_ID`): the platform's
  `x-nf-client-connection-ip` header.
- **Self-hosted:** the `X-Form-Forge-Client-IP` header, which your reverse proxy
  must overwrite. See [Deployment and operations](operations.md#reverse-proxy).
- **Development:** `X-Forwarded-For` when `TRUST_PROXY=1`; otherwise all requests
  share one local bucket.

### Workspace quotas

Each workspace can accept 1,000 new responses and create 5,000 new webhook
deliveries per UTC day. Quotas are reserved in the same transaction as the
response, so failed requests and idempotent retries do not consume them.
Deliveries count once per logical delivery, not per HTTP attempt or manual retry.
When a quota is exhausted, the API returns `429` with `Retry-After` set to the
time until the next UTC day.

A form can have up to five webhook endpoints that are not archived, including
disabled ones.

## OpenAPI

`GET /api/openapi` returns an OpenAPI 3.1 document. It covers the public form and
submit endpoints and the main administration operations: drafts and publishing,
intake and privacy settings, response lists and filters, CSV export, processing
status and response deletion. Request schemas are generated from the same Zod
validators the server uses.

Administration endpoints use the NextAuth session cookie of a signed-in user and
enforce workspace roles. The document does not describe OAuth callbacks,
Inngest and internal test routes, webhook endpoint administration, version
history or member management.

## MCP

`POST /api/admin/mcp` is a read-only
[Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
endpoint using the Streamable HTTP transport. It is stateless and returns JSON
responses only: there is no SSE stream or session store, and `GET` and `DELETE`
return `405`. Supported protocol versions are `2025-11-25`, `2025-06-18` and
`2025-03-26`. It implements `initialize`, `ping`, `tools/list`, `tools/call` and
acknowledges notifications.

Each request must carry the NextAuth session cookie of a signed-in user and pass
the same origin checks as the administration interface. API keys and OAuth
authorization for MCP clients are not supported, so the endpoint suits
first-party and local integrations that can use a browser session.

Send `Content-Type: application/json`,
`Accept: application/json, text/event-stream` and, after initialization, the
negotiated `MCP-Protocol-Version` header. Request bodies are limited to 64 KiB.

Available tools, each taking `workspaceSlug` plus resource IDs or filters:

- `list_forms`: up to 100 forms, with a flag when the list is truncated.
- `get_form`: one form.
- `list_submissions`: responses, with the same cursor and filters as the HTTP API.
- `get_submission`: one response with a bounded delivery history.

Tools use the same services and permissions as the application, so a viewer
cannot gain write access. There are no tools for publishing, deleting, delivery or
changing settings. Treat returned answers as untrusted user content.
