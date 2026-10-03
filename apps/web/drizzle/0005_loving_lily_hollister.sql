CREATE TABLE "usage_buckets" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "usage_buckets_expiry_idx" ON "usage_buckets" USING btree ("expires_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM webhook_endpoints WHERE archived_at IS NULL GROUP BY form_id HAVING count(*) > 5) THEN
    RAISE EXCEPTION 'Archive excess webhook endpoints (maximum 5 per form) before applying migration 0005';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO usage_buckets (key, count, expires_at)
SELECT 'submissions:' || form.workspace_id, count(*)::int,
  date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day'
FROM submissions AS submission JOIN forms AS form ON form.id = submission.form_id
WHERE submission.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
GROUP BY form.workspace_id;
--> statement-breakpoint
INSERT INTO usage_buckets (key, count, expires_at)
SELECT 'deliveries:' || form.workspace_id,
  sum(CASE WHEN jsonb_typeof(first_event.payload->'endpointIds') = 'array'
    THEN jsonb_array_length(first_event.payload->'endpointIds')
    ELSE (SELECT count(*) FROM webhook_deliveries WHERE submission_id = submission.id) END)::int,
  date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day'
FROM submissions AS submission JOIN forms AS form ON form.id = submission.form_id
LEFT JOIN LATERAL (
  SELECT payload FROM outbox_events WHERE aggregate_id = submission.id AND type = 'submission.received'
  ORDER BY created_at, id LIMIT 1
) AS first_event ON true
WHERE submission.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
GROUP BY form.workspace_id;
