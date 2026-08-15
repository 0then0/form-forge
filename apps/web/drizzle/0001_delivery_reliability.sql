ALTER TABLE "webhook_deliveries" ADD COLUMN "locked_until" timestamptz;
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_token" uuid;

UPDATE "webhook_deliveries"
SET
  "status" = 'pending',
  "next_attempt_at" = now(),
  "last_error" = COALESCE(
    "last_error",
    'Legacy processing delivery rescheduled during lease migration'
  ),
  "updated_at" = now()
WHERE "status" = 'processing';

CREATE INDEX "webhook_deliveries_due_idx"
  ON "webhook_deliveries" ("status", "next_attempt_at", "locked_until");

UPDATE "outbox_events"
SET "type" = 'delivery.requested'
WHERE "type" = 'delivery.retry_requested'
  AND "status" IN ('pending', 'processing', 'failed');

WITH "ranked_active_events" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "type", "aggregate_id"
      ORDER BY "created_at", "id"
    ) AS "position"
  FROM "outbox_events"
  WHERE "status" IN ('pending', 'processing', 'failed')
)
UPDATE "outbox_events"
SET
  "status" = 'sent',
  "sent_at" = COALESCE("sent_at", now()),
  "last_error" = 'Superseded while adding active-event uniqueness'
WHERE "id" IN (
  SELECT "id"
  FROM "ranked_active_events"
  WHERE "position" > 1
);

CREATE UNIQUE INDEX "outbox_active_aggregate_idx"
  ON "outbox_events" ("type", "aggregate_id")
  WHERE "status" IN ('pending', 'processing', 'failed');
