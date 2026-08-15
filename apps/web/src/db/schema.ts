import type { FormSchemaV1 } from "@form-forge/form-schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const roleEnum = pgEnum("membership_role", [
  "owner",
  "editor",
  "viewer",
]);
export const formStatusEnum = pgEnum("form_status", [
  "draft",
  "published",
  "archived",
]);
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "processing",
  "succeeded",
  "failed",
]);
export const attemptStatusEnum = pgEnum("attempt_status", [
  "succeeded",
  "failed",
]);
export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "processing",
  "sent",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  ...timestamps,
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("workspaces_slug_idx").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    status: formStatusEnum("status").default("draft").notNull(),
    draftSchema: jsonb("draft_schema").$type<FormSchemaV1>().notNull(),
    publishedVersionId: uuid("published_version_id").references(
      (): AnyPgColumn => formVersions.id,
    ),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("forms_slug_idx").on(table.slug),
    index("forms_workspace_idx").on(table.workspaceId, table.updatedAt),
  ],
);

export const formVersions = pgTable(
  "form_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    schema: jsonb("schema").$type<FormSchemaV1>().notNull(),
    schemaHash: varchar("schema_hash", { length: 64 }).notNull(),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("form_versions_number_idx").on(
      table.formId,
      table.versionNumber,
    ),
    index("form_versions_hash_idx").on(table.formId, table.schemaHash),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id),
    formVersionId: uuid("form_version_id")
      .notNull()
      .references(() => formVersions.id),
    receivedValues: jsonb("received_values")
      .$type<Record<string, string | number | boolean>>()
      .notNull(),
    normalizedValues: jsonb("normalized_values")
      .$type<Record<string, string | number | boolean>>()
      .notNull(),
    utm: jsonb("utm").$type<Record<string, string>>().notNull(),
    fingerprintHash: varchar("fingerprint_hash", { length: 64 }),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    deliveryStatus: deliveryStatusEnum("delivery_status")
      .default("pending")
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("submissions_idempotency_idx").on(
      table.formId,
      table.idempotencyKey,
    ),
    index("submissions_form_created_idx").on(table.formId, table.createdAt),
  ],
);

export const submissionEvents = pgTable(
  "submission_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 80 }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("submission_events_submission_idx").on(table.submissionId)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    url: text("url").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("webhook_endpoints_form_idx").on(table.formId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id),
    status: deliveryStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    manualRetryCount: integer("manual_retry_count").default(0).notNull(),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    activeAttemptUrl: text("active_attempt_url"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("webhook_deliveries_submission_endpoint_idx").on(
      table.submissionId,
      table.endpointId,
    ),
    index("webhook_deliveries_status_idx").on(table.status, table.updatedAt),
    index("webhook_deliveries_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.lockedUntil,
    ),
  ],
);

export const deliveryAttempts = pgTable(
  "delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: attemptStatusEnum("status").notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms").notNull(),
    responseExcerpt: text("response_excerpt"),
    requestUrl: text("request_url"),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("delivery_attempts_number_idx").on(
      table.deliveryId,
      table.attemptNumber,
    ),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 100 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("outbox_pending_idx").on(table.status, table.availableAt),
    uniqueIndex("outbox_active_aggregate_idx")
      .on(table.type, table.aggregateId)
      .where(sql`${table.status} in ('pending', 'processing', 'failed')`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }).notNull(),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

export type MembershipRole = (typeof roleEnum.enumValues)[number];
export type DeliveryStatus = (typeof deliveryStatusEnum.enumValues)[number];
