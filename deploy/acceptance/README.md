# Installation checklist

Use this checklist to verify a real installation: public TLS, GitHub sign-in,
webhook delivery to a public receiver, and recovery. Run it on a disposable
installation with your own domain, GitHub OAuth app and an HTTPS receiver you
control. Never use shared or production resources, or someone else's endpoint.

The [automated acceptance test](../VERIFICATION.md#automated-acceptance-test)
covers delivery, backup and restore on a local, isolated network, but cannot
check public DNS, TLS certificates or live OAuth. This checklist covers those.

The commands below use the `dc` function from the
[installation guide](../README.md#3-build-migrate-and-start).

## Public TLS and OAuth

Install using [the guide](../README.md), then check the certificate without
`--insecure`:

```sh
curl --fail https://<PUBLIC_HOST>/login
curl -i https://<PUBLIC_HOST>/api/inngest
```

The first must render and the second must return 404 at ingress. From another
machine verify origin port 3000 and ports 5432, 6379, 8288, 8289 are unreachable.
Sign in through GitHub and check that the callback succeeds and a personal
workspace is created. Then test owner, editor and viewer permissions with real
accounts.

## Public receiver

Run [acceptance-receiver.mjs](../../apps/web/scripts/acceptance-receiver.mjs) only
on a host you control, with `/tls/fullchain.pem`,
`/tls/privkey.pem`, writable `/evidence`, and `RECEIVER_SECRET` set to the secret
returned when creating the application endpoint. It listens on HTTPS 443; its
HTTP control port 8889 must stay private. Alternatively implement the same
verification contract in your receiver.

The receiver checks HMAC-SHA256 over `<timestamp>.<original body bytes>`, a
five-minute timestamp tolerance, and header/envelope delivery-ID equality. It
retains verification metadata, body hash, timestamp, logical ID and ordinal, not
submission content, endpoint secret or signature. `/success` returns 200;
`/retry` returns 503 on the first valid logical-ID request and then 200; `/hold`
records the first request without acknowledging it, then returns 200 on
redelivery. Do not restart the receiver between a sequence's requests: its ordinal
counter is in memory. Its evidence file is persistent; a production receiver must
implement durable side-effect deduplication separately.

Publish a small synthetic form and create the endpoint through the normal UI.
Fetch its current schema and submit over ingress, using a fresh idempotency key:

```sh
curl --fail https://<PUBLIC_HOST>/api/forms/<SLUG>
curl --fail https://<PUBLIC_HOST>/api/forms/<SLUG>/submit \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: owner-acceptance-001' \
  --data-binary '{"versionId":"<VERSION_ID>","values":{"name":"Synthetic acceptance"}}'
```

Acceptance requires the submission transaction, persisted outbox, a real
Inngest function run, receiver verification and persisted attempt/result. Inspect
only IDs and state when retaining evidence:

```sh
dc exec -T postgres psql -U form_forge -d form_forge -c "select id, delivery_status from submissions order by created_at desc limit 5"
dc exec -T postgres psql -U form_forge -d form_forge -c "select id, aggregate_id, type, status, attempts, available_at, sent_at from outbox_events order by created_at desc limit 20"
dc exec -T postgres psql -U form_forge -d form_forge -c "select id, submission_id, status, attempt_count, next_attempt_at, locked_until from webhook_deliveries order by created_at desc limit 10"
dc exec -T postgres psql -U form_forge -d form_forge -c "select delivery_id, attempt_number, status, http_status, error_code, started_at, completed_at from delivery_attempts order by started_at desc limit 20"
```

## Recovery and restore

Repeat these bounded drills, observing database and receiver state rather than
using elapsed sleeps as proof:

1. Stop only `dc stop inngest`, submit, confirm one submission and pending outbox
   atomically, then `dc start inngest`. Wait for a completed five-minute cron and
   successful delivery. Do not invoke recovery functions manually.
2. Use `/retry`, observe HTTP 503 attempt and `next_attempt_at`, then allow the
   unchanged scheduler to retry. Expect a 200 under the same delivery ID.
3. Use `/hold`, wait until receiver evidence exists and the delivery has an active
   lease. On this disposable deployment only, `dc kill -s SIGKILL web; dc start web`. After lease expiry and cron recovery, require a `WORKER_LEASE_EXPIRED`
   attempt, a successful attempt, and two receiver observations under one ID.
4. With a pending retry, use `dc restart inngest`. Verify stored work progresses
   with the same SQLite/Redis volumes. This is graceful scheduler restart, not
   power-loss recovery.
5. Follow the full backup/isolated restore commands in the guide, verifying the whole
   backup before creating a new project with three empty stores. Stop and retain
   the source; inspect destination volume names/mounts and service addresses. Check all three
   store archives and keys, published schema hashes, counts, endpoint-secret
   decryption and pending-delivery behavior in the destination. Preserve the
   source. Coordinate real receiver effects before replaying a restored backup.

Record the release/commit/source checksum, component digests, UTC times, logical
event/delivery IDs, transitions, completed cron run IDs, receiver verification and
recovery duration relative to due time and cron tick. Exclude credentials, OAuth
tokens, sessions and submission bodies. Mark each check passed, failed or not run,
with the exact missing prerequisite.
