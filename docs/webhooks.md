# Webhooks

[Project overview](../README.md) · [Documentation](../README.md#documentation)

Form Forge sends each accepted response to the form's active webhook endpoints.
Delivery runs in the background, so a response is saved even when a receiver is
slow or unavailable.

## Request format

Each delivery is a JSON `POST` request:

```json
{
  "apiVersion": "2026-08-15",
  "id": "<delivery-id>",
  "type": "submission.created",
  "createdAt": "2026-10-18T12:00:00.000Z",
  "data": {
    "form": { "id": "<form-id>", "name": "Contact", "slug": "contact" },
    "version": { "id": "<version-id>", "number": 3 },
    "submission": {
      "id": "<submission-id>",
      "createdAt": "2026-10-18T12:00:00.000Z",
      "values": { "name": "Ada" },
      "utm": {}
    }
  }
}
```

`submission.created` is currently the only event type. `values` contains the
normalized answers keyed by field key. `utm` contains UTM parameters when the
form collects source metadata and is an empty object otherwise.

The request includes these headers:

```txt
Content-Type: application/json
User-Agent: Form-Forge-Webhooks/1.0
X-Form-Forge-Id: <delivery-id>
X-Form-Forge-Timestamp: <unix-timestamp-seconds>
X-Form-Forge-Signature: v1=<hex-hmac-sha256>
```

## Verify the signature

The signature is an HMAC-SHA256, encoded as hex, of `<timestamp>.<raw-body>`,
keyed with the endpoint secret. Compute it over the exact request bytes; parsing
and reserializing the JSON changes the bytes and breaks verification. Reject
requests with an old timestamp to limit replay.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyFormForgeRequest(rawBody, headers, secret) {
  const timestamp = headers["x-form-forge-timestamp"];
  const received = headers["x-form-forge-signature"] ?? "";
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = `v1=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}
```

The secret is shown once, when you create an endpoint or rotate its secret.
Form Forge stores it encrypted with AES-256-GCM.

## Responses, retries and deduplication

Return any `2xx` status to acknowledge a delivery. Each request times out after
10 seconds. Retryable failures are retried automatically, up to five attempts,
with delays of 1 minute, 5 minutes, 30 minutes and 2 hours. Configuration
failures may need to be corrected before a retry can succeed. Every attempt and its error is visible under
**Deliveries**.

Editors and owners can retry a failed delivery manually; each manual retry adds
five more attempts to that delivery's budget.

Delivery is **at least once**. The same delivery can arrive more than once, for
example after a lost acknowledgement, a manual retry or a restore from backup.
Store `X-Form-Forge-Id` and skip deliveries you have already processed before
performing side effects.

## Endpoint management

Workspace owners can create, edit, disable, enable and archive endpoints, and
rotate their secrets. A form can have up to five endpoints that are not archived,
including disabled ones; archive an endpoint to free a slot. Endpoint URLs must
use public HTTPS addresses: localhost and private-network targets are rejected.

See [workspace access](user-guide.md#workspace-access) for role permissions and
[API limits](api.md#limits) for delivery quotas.

## How delivery works

A response and its outbox event are written in the same PostgreSQL transaction,
so an accepted response is never left without delivery work. After the
transaction commits, the application immediately hands that response's work to
[Inngest](https://www.inngest.com/), which creates the deliveries and sends them.
Delivery state and attempt history are stored in PostgreSQL, not only in logs.

A recovery job runs every five minutes (`*/5 * * * *`). It sends outbox events
that are due, recovers deliveries whose worker stopped, and requeues responses
whose deliveries were never created. It handles at most 50 outbox events per run.
If Inngest is unavailable, responses are still accepted and delivery resumes
after the scheduler recovers; this can take more than one recovery run.

Immediate dispatch needs a Next.js runtime that supports `after()`: `next dev`,
`next start`, the standalone server, or an adapter with `waitUntil` support, such
as the Netlify OpenNext adapter. On other runtimes, delivery waits for the
recovery job.
