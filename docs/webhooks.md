# Webhooks

[Project overview](../README.md) · [Documentation](../README.md#documentation)

Webhook requests are JSON `POST` requests with an envelope containing `apiVersion`, `id`, `type`, `createdAt`, and `data`. The current event type is `submission.created`; `data` contains the form identity, normalized submission values and UTM metadata, and the form version identity.

Requests include:

```txt
X-Form-Forge-Id: <delivery-id>
X-Form-Forge-Timestamp: <unix-timestamp-seconds>
X-Form-Forge-Signature: v1=<hex-hmac-sha256>
```

Verify the signature with the endpoint secret using HMAC-SHA256 over `<timestamp>.<raw-body>`. Use the original request bytes, not reserialized JSON. Endpoint secrets are shown on creation or rotation and stored encrypted with AES-256-GCM.

Return a `2xx` response to acknowledge delivery. Requests have a 10-second timeout. Retryable failures are retried automatically within an initial budget of five attempts; an authorized manual retry increases the total attempt budget by five. Configuration failures can require correction before retrying. Attempts and errors remain visible in the application.

Delivery is **at-least-once**. Consumers must deduplicate by `X-Form-Forge-Id`, including manual retries of the same delivery. Recovery jobs reclaim expired worker leases and requeue submissions whose delivery creation did not complete. Retry timing is driven by persisted scheduling and the five-minute recovery job; the immediate path dispatches only work that is already due.

## Endpoint management

Workspace owners can edit, disable, enable or archive endpoints and rotate their
secrets. Forms support up to five non-archived endpoints, including disabled ones;
archive an endpoint to free a slot. See [workspace access](user-guide.md#workspace-access)
for role permissions and [API limits](api.md#limits) for delivery quotas.

## Delivery and recovery

Both processes are needed to exercise webhook delivery. Submissions and their outbox events are committed atomically. After commit, Next.js `after()` attempts ingestion of only the current response's work. An Inngest step then attempts ingestion of its newly created deliveries immediately. The dispatcher uses the existing claims, leases and deterministic event IDs; it sends at most five events concurrently and the immediate path selects at most six events for one response. Inngest HTTP requests have a two-second timeout per SDK attempt, including response-body consumption; SDK retries remain bounded. There are no detached background promises.

Recovery still runs every five minutes (`*/5 * * * *`): 288 scheduled runs per day, or 8,640 over 30 days, excluding retries. Fast-path failure does not change an accepted response into a submission error. Pending/failed outbox events survive a scheduler outage and retry after their persisted due time. Run Next.js through `next dev`, `next start`, the standalone server, or an adapter that supports `after`/`waitUntil` (including the Netlify OpenNext adapter). Adapters without that lifecycle use cron recovery. Two recovery stages can still require two cron ticks during an outage or failed immediate ingestion; normal first delivery no longer intentionally waits for cron. Without Inngest, responses remain stored and delivery waits for scheduler recovery.
