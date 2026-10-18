CREATE TABLE "deleted_submission_keys" (
	"form_id" uuid NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deleted_submission_keys_form_id_key_hash_pk" PRIMARY KEY("form_id","key_hash")
);
--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "collect_metadata" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "closes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "max_accepted" integer;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "accepted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "closed_message" varchar(500) DEFAULT 'This form is no longer accepting responses.' NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "policy_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "processing_status" varchar(16) DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "deleted_submission_keys" ADD CONSTRAINT "deleted_submission_keys_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleted_submission_keys_expiry_idx" ON "deleted_submission_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "submissions_search_idx" ON "submissions" USING gin (jsonb_to_tsvector('simple'::regconfig, "normalized_values", '["string", "numeric", "boolean"]'::jsonb));--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_max_accepted_check" CHECK ("forms"."max_accepted" is null or "forms"."max_accepted" > 0);--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_accepted_count_check" CHECK ("forms"."accepted_count" >= 0);--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_processing_status_check" CHECK ("submissions"."processing_status" in ('new', 'processed'));--> statement-breakpoint
-- Existing installations retain the old metadata policy. Defaults for future
-- inserts remain false; no historical submission or immutable schema is changed.
UPDATE forms SET collect_metadata = true;
--> statement-breakpoint
UPDATE forms SET accepted_count = (
  SELECT count(*)::int FROM submissions WHERE submissions.form_id = forms.id
);
