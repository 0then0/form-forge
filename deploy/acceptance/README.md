# Installation checklist

Use this checklist to confirm that a real installation works end to end: public
TLS, GitHub sign-in, webhook delivery to a public receiver, and recovery after
failures. Run it on a separate test installation with your own domain, your own
GitHub OAuth app and an HTTPS receiver you control. Never run it against shared
or production resources, or against someone else's endpoint.

The [automated acceptance test](../VERIFICATION.md#automated-acceptance-test)
already covers delivery, backup and restore on an isolated local network. It
cannot check public DNS, TLS certificates or live OAuth; this checklist covers
those.

The commands below use the `dc` shell function from the
[installation guide](../README.md#3-build-migrate-and-start).

## 1. Public TLS and sign-in

Install Form Forge by following [the guide](../README.md). Then check the
certificate (do not pass `--insecure`):

```sh
curl --fail https://<PUBLIC_HOST>/login
curl -i https://<PUBLIC_HOST>/api/inngest
```

The first request must return the sign-in page. The second must return `404`
from Nginx, because the Inngest endpoint is not exposed publicly.

From another machine, confirm that ports 3000, 5432, 6379, 8288 and 8289 on the
host are not reachable. Of the Form Forge services, only Nginx on port 443 may
be public.

Sign in with GitHub and check that the callback succeeds and a personal
workspace is created. Then test the owner, editor and viewer roles with real
accounts.

## 2. Webhook delivery to a public receiver

You need an HTTPS endpoint that verifies Form Forge signatures. You can use the
included test receiver,
[acceptance-receiver.mjs](../../apps/web/scripts/acceptance-receiver.mjs), on a
host you control, or implement the same checks in your own receiver.

The test receiver expects:

- the TLS certificate chain at `/tls/fullchain.pem` and the key at
  `/tls/privkey.pem`;
- a writable `/evidence` directory for its records;
- `RECEIVER_SECRET` set to the secret shown when you create the webhook
  endpoint in Form Forge.

It listens for HTTPS on port 443. Its HTTP control port 8889 must stay private.

For each request, the receiver verifies the HMAC-SHA256 signature over
`<timestamp>.<original body bytes>`, rejects timestamps more than five minutes
from its own clock in either direction, and checks that the delivery ID in the header matches the one in the body.
It records only verification results, a hash of the body, the timestamp, the
delivery ID and a sequence number. It does not store response content, the
endpoint secret or the signature.

The receiver has three paths:

- `/success` always returns `200`.
- `/retry` returns `503` for the first valid request with a given delivery ID
  and `200` afterwards.
- `/hold` records the first request without answering it, then returns `200`
  when the same delivery arrives again.

The sequence counter is kept in memory, so do not restart the receiver in the
middle of a scenario. The evidence file is persistent. A production receiver
must deduplicate deliveries durably on its own; see
[Webhooks](../../docs/webhooks.md).

Create a small test form with synthetic fields, publish it and add the receiver
as a webhook endpoint in the normal interface. Fetch the form's current version,
then submit a response through the public HTTPS address with a new idempotency
key:

```sh
curl --fail https://<PUBLIC_HOST>/api/forms/<SLUG>
curl --fail https://<PUBLIC_HOST>/api/forms/<SLUG>/submit \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: owner-acceptance-001' \
  --data-binary '{"versionId":"<VERSION_ID>","values":{"name":"Synthetic acceptance"}}'
```

The check passes when the submission and its outbox event were stored, a real
Inngest function ran, the receiver verified the request, and the delivery
attempt and its result were stored. To inspect the state, query only IDs and
statuses, not response content:

```sh
dc exec -T postgres psql -U form_forge -d form_forge -c "select id, delivery_status from submissions order by created_at desc limit 5"
dc exec -T postgres psql -U form_forge -d form_forge -c "select id, aggregate_id, type, status, attempts, available_at, sent_at from outbox_events order by created_at desc limit 20"
dc exec -T postgres psql -U form_forge -d form_forge -c "select id, submission_id, status, attempt_count, next_attempt_at, locked_until from webhook_deliveries order by created_at desc limit 10"
dc exec -T postgres psql -U form_forge -d form_forge -c "select delivery_id, attempt_number, status, http_status, error_code, started_at, completed_at from delivery_attempts order by started_at desc limit 20"
```

## 3. Recovery and restore

Run each scenario below and judge the result by the database and receiver
state, not by waiting a fixed amount of time.

1. **Scheduler outage.** Run `dc stop inngest` and submit a response. Confirm
   that the submission and a pending outbox event were stored together. Run
   `dc start inngest`, wait for a completed five-minute recovery run, and
   confirm the delivery succeeded. Do not start recovery functions manually.
2. **Retry after an error.** Use the `/retry` path. Confirm a `503` attempt with
   a `next_attempt_at` time, then let the scheduler retry. Expect a `200` with
   the same delivery ID.
3. **Worker crash before acknowledgement.** Use the `/hold` path and wait until
   the receiver has recorded the request and the delivery holds an active lease.
   On this test installation only, run `dc kill -s SIGKILL web; dc start web`.
   After the lease expires and a recovery run completes, expect a
   `WORKER_LEASE_EXPIRED` attempt, a successful attempt, and two receiver records
   with the same delivery ID.
4. **Scheduler restart.** With a retry pending, run `dc restart inngest` and
   confirm that the stored work continues with the same SQLite and Redis
   volumes. This tests a graceful restart, not recovery from power loss.
5. **Backup and restore.** Follow the
   [backup and isolated restore](../README.md#backup-and-isolated-restore)
   commands. Verify the whole backup before creating a new project with three
   empty stores. Stop the source installation but keep it. In the restored
   project, check that volume names, mounts and service addresses differ from
   the source; that all three store archives and the keys were restored; that
   published schema hashes and record counts match; that webhook endpoint
   secrets can be decrypted; and that pending deliveries continue. A restored
   installation may resend deliveries, so coordinate with the receiver's owner
   first.

## Record the results

For each check, record whether it passed, failed or was not run, and for checks
not run, the missing prerequisite. Include the release, commit or source
checksum, component image digests, UTC times, delivery IDs, state transitions,
recovery run IDs, receiver verification results, and how long recovery took
compared with the scheduled retry time and the recovery interval.

Do not record credentials, OAuth tokens, sessions or response content.
