CREATE TYPE "public"."membership_role" AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE "public"."form_status" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "public"."delivery_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed');
CREATE TYPE "public"."attempt_status" AS ENUM ('succeeded', 'failed');
CREATE TYPE "public"."outbox_status" AS ENUM ('pending', 'processing', 'sent', 'failed');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text,
  "email" text UNIQUE,
  "email_verified" timestamptz,
  "image" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "accounts" (
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY ("provider", "provider_account_id")
);

CREATE TABLE "sessions" (
  "session_token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "expires" timestamptz NOT NULL
);

CREATE TABLE "verification_tokens" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamptz NOT NULL,
  CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY ("identifier", "token")
);

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "slug" varchar(80) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "memberships" (
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "membership_role" NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY ("workspace_id", "user_id")
);

CREATE TABLE "forms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "slug" varchar(80) NOT NULL,
  "status" "form_status" DEFAULT 'draft' NOT NULL,
  "draft_schema" jsonb NOT NULL,
  "published_version_id" uuid,
  "created_by" uuid NOT NULL,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "form_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "schema" jsonb NOT NULL,
  "schema_hash" varchar(64) NOT NULL,
  "published_by" uuid NOT NULL,
  "published_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_id" uuid NOT NULL,
  "form_version_id" uuid NOT NULL,
  "received_values" jsonb NOT NULL,
  "normalized_values" jsonb NOT NULL,
  "utm" jsonb NOT NULL,
  "fingerprint_hash" varchar(64),
  "referrer" text,
  "user_agent" text,
  "delivery_status" "delivery_status" DEFAULT 'pending' NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "submission_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "type" varchar(80) NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_id" uuid NOT NULL,
  "name" varchar(120) NOT NULL,
  "url" text NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "endpoint_id" uuid NOT NULL,
  "status" "delivery_status" DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "manual_retry_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "next_attempt_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "status" "attempt_status" NOT NULL,
  "http_status" integer,
  "duration_ms" integer NOT NULL,
  "response_excerpt" text,
  "error_code" varchar(80),
  "error_message" text,
  "started_at" timestamptz NOT NULL,
  "completed_at" timestamptz NOT NULL
);

CREATE TABLE "outbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" varchar(100) NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "outbox_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "sent_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "action" varchar(100) NOT NULL,
  "resource_type" varchar(80) NOT NULL,
  "resource_id" uuid,
  "metadata" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE;
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "users"("id");
ALTER TABLE "forms" ADD CONSTRAINT "forms_published_version_id_form_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "form_versions"("id");
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"("id");
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id");
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id");
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries"("id") ON DELETE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id");

CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" ("slug");
CREATE UNIQUE INDEX "forms_slug_idx" ON "forms" ("slug");
CREATE INDEX "forms_workspace_idx" ON "forms" ("workspace_id", "updated_at");
CREATE UNIQUE INDEX "form_versions_number_idx" ON "form_versions" ("form_id", "version_number");
CREATE INDEX "form_versions_hash_idx" ON "form_versions" ("form_id", "schema_hash");
CREATE UNIQUE INDEX "submissions_idempotency_idx" ON "submissions" ("form_id", "idempotency_key");
CREATE INDEX "submissions_form_created_idx" ON "submissions" ("form_id", "created_at");
CREATE INDEX "submission_events_submission_idx" ON "submission_events" ("submission_id");
CREATE INDEX "webhook_endpoints_form_idx" ON "webhook_endpoints" ("form_id");
CREATE UNIQUE INDEX "webhook_deliveries_submission_endpoint_idx" ON "webhook_deliveries" ("submission_id", "endpoint_id");
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" ("status", "updated_at");
CREATE UNIQUE INDEX "delivery_attempts_number_idx" ON "delivery_attempts" ("delivery_id", "attempt_number");
CREATE INDEX "outbox_pending_idx" ON "outbox_events" ("status", "available_at");
CREATE INDEX "audit_logs_workspace_idx" ON "audit_logs" ("workspace_id", "created_at");
