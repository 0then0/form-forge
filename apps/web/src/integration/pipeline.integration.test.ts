// @vitest-environment node

import { defaultFormSchema, type FormSchemaV1 } from "@form-forge/form-schema";
import { and, count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHash, createHmac } from "node:crypto";
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    email: "integration@example.com",
    id: auth.userId,
    name: "Integration user",
  })),
}));

import { POST as submitRoute } from "../../app/api/forms/[slug]/submit/route";
import { inngest } from "@/inngest/client";
import { db } from "@/db/client";
import {
  auditLogs,
  deletedSubmissionKeys,
  deliveryAttempts,
  forms,
  formVersions,
  memberships,
  outboxEvents,
  submissionEvents,
  submissions,
  users,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
  usageBuckets,
} from "@/db/schema";
import { encryptWebhookSecret } from "@/integration/webhooks/crypto";
import { AppError } from "@/lib/errors";
import {
  createDeliveriesForSubmission,
  deliverWebhook,
  requestManualRetry,
} from "@/services/deliveries";
import {
  updateFormPolicy,
  getForm,
  getFormForViewing,
  archiveForm,
  permanentlyDeleteForm,
  restoreArchivedForm,
  listArchivedForms,
  publishSavedDraft,
  createForm,
  listFormVersions,
  publishForm,
  restoreDraftFromVersion,
  saveDraft,
} from "@/services/forms";
import { updateMember } from "@/services/memberships";
import {
  dispatchSubmissionOutbox,
  dispatchPendingOutbox,
  enqueueDueDeliveries,
  enqueueUnprocessedSubmissions,
} from "@/services/outbox";
import { getPublishedForm, receiveSubmission } from "@/services/public-forms";
import {
  consumeUsage,
  limitSubmitRequest,
  removeExpiredUsage,
} from "@/services/usage";
import { inspectPipelineHealth } from "@/services/pipeline-health";
import { reconcileSubmissionDeliveryStatus } from "@/services/submission-delivery-status";
import {
  deleteSubmission,
  updateSubmissionStatus,
  exportSubmissionsCsv,
  getSubmissionDetail,
  listSubmissions,
} from "@/services/submissions";
import {
  archiveWebhookEndpoint,
  createWebhookEndpoint,
  rotateWebhookEndpointSecret,
  updateWebhookEndpoint,
} from "@/services/webhook-endpoints";
import {
  MAX_DAILY_SUBMISSIONS,
  MAX_DAILY_DELIVERIES,
  MAX_WEBHOOK_ENDPOINTS,
} from "@/lib/usage-policy";

vi.mock("@/integration/webhooks/url-policy", () => ({
  validateWebhookUrl: vi.fn(async (url: string) => url),
}));

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

const schema = (): FormSchemaV1 => ({
  ...defaultFormSchema(),
  title: "Integration form",
  fields: [
    {
      id: crypto.randomUUID(),
      key: "name",
      label: "Name",
      required: true,
      type: "shortText",
      width: "full",
    },
  ],
});

const schemaHash = (value: FormSchemaV1) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const seedWorkspace = async (role: "owner" | "editor" | "viewer" = "owner") => {
  const [user] = await db
    .insert(users)
    .values({ email: `${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: "Integration", slug: `test-${crypto.randomUUID()}` })
    .returning({ id: workspaces.id, slug: workspaces.slug });
  if (!user || !workspace) throw new Error("Could not seed workspace");
  await db.insert(memberships).values({
    role,
    userId: user.id,
    workspaceId: workspace.id,
  });
  auth.userId = user.id;
  return { user, workspace };
};

const seedForm = async ({
  formSchema = schema(),
  collectMetadata = true,
  published = true,
  workspaceId,
  userId,
}: {
  formSchema?: FormSchemaV1;
  collectMetadata?: boolean;
  published?: boolean;
  userId: string;
  workspaceId: string;
}) => {
  const [form] = await db
    .insert(forms)
    .values({
      collectMetadata,
      createdBy: userId,
      draftSchema: formSchema,
      name: formSchema.title,
      slug: `form-${crypto.randomUUID()}`,
      status: published ? "published" : "draft",
      workspaceId,
    })
    .returning({ id: forms.id, slug: forms.slug, updatedAt: forms.updatedAt });
  if (!form) throw new Error("Could not seed form");
  if (!published) return { form, schema: formSchema, version: null };

  const [version] = await db
    .insert(formVersions)
    .values({
      formId: form.id,
      publishedBy: userId,
      schema: formSchema,
      schemaHash: schemaHash(formSchema),
      versionNumber: 1,
    })
    .returning({ id: formVersions.id });
  if (!version) throw new Error("Could not seed form version");
  await db
    .update(forms)
    .set({ publishedVersionId: version.id })
    .where(eq(forms.id, form.id));
  return { form, schema: formSchema, version };
};

integration("submission and delivery pipeline", () => {
  beforeAll(async () => {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    const previousFolder = await mkdtemp(
      join(tmpdir(), "ff-previous-migrations-"),
    );
    try {
      await mkdir(join(previousFolder, "meta"));
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.filter(
        (entry: { idx: number }) => entry.idx < 6,
      );
      await writeFile(
        join(previousFolder, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries)
        await copyFile(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(previousFolder, `${entry.tag}.sql`),
        );
      await migrate(db, { migrationsFolder: previousFolder });
      // Seed actual pre-upgrade rows, which do not have any operational columns.
      const legacySchema = schema();
      const legacyUser = crypto.randomUUID();
      const legacyWorkspace = crypto.randomUUID();
      const legacyForm = crypto.randomUUID();
      const legacyVersion = crypto.randomUUID();
      await db.execute(
        sql`insert into users (id, email) values (${legacyUser}, 'legacy@example.com')`,
      );
      await db.execute(
        sql`insert into workspaces (id, name, slug) values (${legacyWorkspace}, 'Legacy', 'legacy')`,
      );
      await db.execute(
        sql`insert into forms (id, workspace_id, created_by, name, slug, draft_schema, status) values (${legacyForm}, ${legacyWorkspace}, ${legacyUser}, 'Legacy', 'legacy-form', ${JSON.stringify(legacySchema)}::jsonb, 'published')`,
      );
      await db.execute(
        sql`insert into form_versions (id, form_id, version_number, schema, schema_hash, published_by) values (${legacyVersion}, ${legacyForm}, 1, ${JSON.stringify(legacySchema)}::jsonb, ${schemaHash(legacySchema)}, ${legacyUser})`,
      );
      await db.execute(
        sql`update forms set published_version_id = ${legacyVersion} where id = ${legacyForm}`,
      );
      await db.execute(
        sql`insert into submissions (form_id, form_version_id, received_values, normalized_values, utm, idempotency_key, referrer, user_agent) values (${legacyForm}, ${legacyVersion}, '{"name":"Historical"}', '{"name":"Historical"}', '{"utm_source":"legacy"}', 'legacy', 'https://legacy.example', 'legacy-agent')`,
      );
      await migrate(db, { migrationsFolder });
      expect(
        await db.select().from(forms).where(eq(forms.id, legacyForm)),
      ).toMatchObject([
        {
          collectMetadata: true,
          acceptedCount: 1,
          paused: false,
          closesAt: null,
          maxAccepted: null,
        },
      ]);
      expect((await getPublishedForm("legacy-form")).version.schema).toEqual(
        legacySchema,
      );
      expect(await db.select().from(submissions)).toMatchObject([
        {
          receivedValues: { name: "Historical" },
          normalizedValues: { name: "Historical" },
          utm: { utm_source: "legacy" },
          referrer: "https://legacy.example",
          userAgent: "legacy-agent",
          processingStatus: "new",
        },
      ]);
    } finally {
      await rm(previousFolder, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table usage_buckets, outbox_events, users, workspaces cascade`,
    );
  });

  test("allows private read-only access to archived schemas and versions without reopening mutations or public access", async () => {
    const { user, workspace } = await seedWorkspace();
    const formSchema: FormSchemaV1 = {
      ...schema(),
      fields: [
        {
          id: crypto.randomUUID(),
          key: "consent",
          label: "I accept",
          type: "checkbox",
          width: "full",
          required: true,
          link: { label: "Terms", url: "https://example.com/terms" },
        },
      ],
    };
    const created = await createForm(workspace.slug, "Archived agreement");
    const published = await publishForm(workspace.slug, created.id, {
      expectedRevision: created.updatedAt.toISOString(),
      schema: formSchema,
    });
    await archiveForm(workspace.slug, created.id);
    const archived = await getFormForViewing(workspace.slug, created.id);
    expect(archived.status).toBe("archived");
    expect(archived.draftSchema.fields[0]).toMatchObject({
      link: { label: "Terms", url: "https://example.com/terms" },
    });
    expect(
      (await listFormVersions(workspace.slug, created.id)).data[0]?.id,
    ).toBe(published.id);
    await expect(getForm(workspace.slug, created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getPublishedForm(created.slug)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const input = {
      expectedRevision: archived.updatedAt.toISOString(),
      schema: formSchema,
    };
    await expect(
      saveDraft(workspace.slug, created.id, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      publishForm(workspace.slug, created.id, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      restoreDraftFromVersion(
        workspace.slug,
        created.id,
        published.id,
        input.expectedRevision,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createWebhookEndpoint(workspace.slug, created.id, {
        name: "Blocked",
        url: "https://receiver.example.org",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db
      .update(memberships)
      .set({ role: "viewer" })
      .where(eq(memberships.userId, user.id));
    expect((await getFormForViewing(workspace.slug, created.id)).id).toBe(
      created.id,
    );
    const other = await seedWorkspace();
    await expect(
      getFormForViewing(other.workspace.slug, created.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      listFormVersions(other.workspace.slug, created.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("lists archive and save timestamps independently without treating archive or unarchive as saves", async () => {
    const { workspace } = await seedWorkspace();
    const created = await createForm(workspace.slug, "Archive dates");
    await saveDraft(workspace.slug, created.id, {
      expectedRevision: created.updatedAt.toISOString(),
      schema: { ...created.draftSchema, description: "Saved content" },
    });
    await db
      .update(auditLogs)
      .set({ createdAt: new Date("2026-08-01T10:00:00.000Z") })
      .where(eq(auditLogs.resourceId, created.id));
    const savedAt = new Date("2026-08-02T10:00:00.000Z");
    await db
      .update(auditLogs)
      .set({ createdAt: savedAt })
      .where(
        and(
          eq(auditLogs.resourceId, created.id),
          eq(auditLogs.action, "form.draft_saved"),
        ),
      );
    await archiveForm(workspace.slug, created.id);
    const [archived] = await listArchivedForms(workspace.slug);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(archived?.lastSavedAt).toEqual(savedAt);
    expect(archived?.lastSavedAt).not.toEqual(archived?.archivedAt);
    await restoreArchivedForm(workspace.slug, created.id);
    await archiveForm(workspace.slug, created.id);
    expect((await listArchivedForms(workspace.slug))[0]?.lastSavedAt).toEqual(
      savedAt,
    );
  });

  test("restores published and draft forms with their original data and status", async () => {
    const { user, workspace } = await seedWorkspace();
    for (const published of [true, false]) {
      const seeded = await seedForm({
        workspaceId: workspace.id,
        userId: user.id,
        published,
      });
      await archiveForm(workspace.slug, seeded.form.id);
      expect(
        (await listArchivedForms(workspace.slug)).map(({ id }) => id),
      ).toContain(seeded.form.id);
      expect(
        await restoreArchivedForm(workspace.slug, seeded.form.id),
      ).toMatchObject({
        id: seeded.form.id,
        status: published ? "published" : "draft",
      });
      const [restored] = await db
        .select()
        .from(forms)
        .where(eq(forms.id, seeded.form.id));
      expect(restored?.archivedAt).toBeNull();
      expect(restored?.publishedVersionId).toBe(seeded.version?.id ?? null);
    }
  });

  test("publishes the saved draft and rejects a stale list revision", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
      published: false,
    });
    const revision = seeded.form.updatedAt.toISOString();
    await saveDraft(workspace.slug, seeded.form.id, {
      expectedRevision: revision,
      schema: { ...seeded.schema, title: "Updated draft" },
    });
    await expect(
      publishSavedDraft(workspace.slug, seeded.form.id, revision),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [current] = await db
      .select()
      .from(forms)
      .where(eq(forms.id, seeded.form.id));
    if (!current) throw new Error("Missing form");
    await publishSavedDraft(
      workspace.slug,
      seeded.form.id,
      current.updatedAt.toISOString(),
    );
    const [published] = await db
      .select()
      .from(forms)
      .where(eq(forms.id, seeded.form.id));
    expect(published?.status).toBe("published");
    expect(published?.name).toBe("Updated draft");
  });

  test("permanent deletion requires an owner, an archived form and its exact name", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    await expect(
      permanentlyDeleteForm(
        workspace.slug,
        seeded.form.id,
        seeded.schema.title,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await archiveForm(workspace.slug, seeded.form.id);
    await expect(
      permanentlyDeleteForm(workspace.slug, seeded.form.id, "wrong"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await db
      .update(memberships)
      .set({ role: "editor" })
      .where(eq(memberships.userId, user.id));
    await expect(
      permanentlyDeleteForm(
        workspace.slug,
        seeded.form.id,
        seeded.schema.title,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db
      .update(memberships)
      .set({ role: "viewer" })
      .where(eq(memberships.userId, user.id));
    await expect(
      restoreArchivedForm(workspace.slug, seeded.form.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await seedWorkspace();
    await expect(
      permanentlyDeleteForm(
        other.workspace.slug,
        seeded.form.id,
        seeded.schema.title,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      restoreArchivedForm(other.workspace.slug, seeded.form.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("deletes archived form data and queued events while preserving other forms and audit history", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    const other = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const endpoint = await createWebhookEndpoint(
      workspace.slug,
      seeded.form.id,
      { name: "Endpoint", url: "https://receiver.example.org" },
    );
    const submission = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "delete-form",
      input: { versionId: seeded.version.id, values: { name: "Ada" } },
    });
    await createDeliveriesForSubmission(submission.id, [endpoint.id]);
    await archiveForm(workspace.slug, seeded.form.id);
    await permanentlyDeleteForm(
      workspace.slug,
      seeded.form.id,
      seeded.schema.title,
    );
    expect(
      await db.select().from(forms).where(eq(forms.id, seeded.form.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(formVersions)
        .where(eq(formVersions.formId, seeded.form.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(submissions)
        .where(eq(submissions.formId, seeded.form.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.formId, seeded.form.id)),
    ).toHaveLength(0);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
    expect(await db.select().from(submissionEvents)).toHaveLength(0);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
    expect(
      await db.select().from(forms).where(eq(forms.id, other.form.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "form.deleted")),
    ).toHaveLength(1);
  });

  test("refuses deletion until a claimed webhook delivery has completed", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const endpoint = await createWebhookEndpoint(
      workspace.slug,
      seeded.form.id,
      { name: "Endpoint", url: "https://receiver.example.org" },
    );
    const submission = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "active-delete",
      input: { versionId: seeded.version.id, values: { name: "Ada" } },
    });
    await createDeliveriesForSubmission(submission.id, [endpoint.id]);
    await db
      .update(webhookDeliveries)
      .set({ status: "processing", lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(webhookDeliveries.submissionId, submission.id));
    await archiveForm(workspace.slug, seeded.form.id);
    await expect(
      permanentlyDeleteForm(
        workspace.slug,
        seeded.form.id,
        seeded.schema.title,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.select().from(forms).where(eq(forms.id, seeded.form.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, submission.id)),
    ).toHaveLength(1);
  });

  test.each(["submission", "endpoint"] as const)(
    "rejects deletion without waiting for a worker's %s lock, then allows processing and deletion",
    async (lockedResource) => {
      const { user, workspace } = await seedWorkspace();
      const seeded = await seedForm({
        workspaceId: workspace.id,
        userId: user.id,
      });
      if (!seeded.version) throw new Error("Missing version");
      const endpoint = await createWebhookEndpoint(
        workspace.slug,
        seeded.form.id,
        { name: "Endpoint", url: "https://receiver.example.org" },
      );
      const submission = await receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: `delete-lock-${lockedResource}`,
        input: { versionId: seeded.version.id, values: { name: "Ada" } },
      });
      await archiveForm(workspace.slug, seeded.form.id);
      let deletion: ReturnType<typeof permanentlyDeleteForm> | undefined;
      try {
        await db.transaction(async (tx) => {
          const lockSubmission = () =>
            tx
              .select({ id: submissions.id })
              .from(submissions)
              .where(eq(submissions.id, submission.id))
              .for("update", { noWait: true });
          const lockEndpoint = () =>
            tx
              .select({ id: webhookEndpoints.id })
              .from(webhookEndpoints)
              .where(eq(webhookEndpoints.id, endpoint.id))
              .for("update", { noWait: true });
          await (lockedResource === "submission"
            ? lockSubmission()
            : lockEndpoint());
          deletion = permanentlyDeleteForm(
            workspace.slug,
            seeded.form.id,
            seeded.schema.title,
          );
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              expect(deletion).rejects.toMatchObject({
                code: "CONFLICT",
                status: 409,
                message: expect.stringContaining("Background processing"),
              }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("Deletion waited for a worker lock")),
                  3_000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          // A rejected deletion must release all locks it acquired, so the
          // worker can finish even if it next needs the other resource.
          await (lockedResource === "submission"
            ? lockEndpoint()
            : lockSubmission());
        });
      } finally {
        await deletion?.catch(() => undefined);
      }
      expect(
        await db.select().from(forms).where(eq(forms.id, seeded.form.id)),
      ).toHaveLength(1);
      expect(await db.select().from(outboxEvents)).toHaveLength(1);
      expect(
        await createDeliveriesForSubmission(submission.id, [endpoint.id]),
      ).toBe(1);
      await permanentlyDeleteForm(
        workspace.slug,
        seeded.form.id,
        seeded.schema.title,
      );
      expect(
        await db.select().from(forms).where(eq(forms.id, seeded.form.id)),
      ).toHaveLength(0);
      expect(await db.select().from(submissions)).toHaveLength(0);
      expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
      expect(await db.select().from(outboxEvents)).toHaveLength(0);
    },
    10_000,
  );

  test("applies the migrations to the dedicated PostgreSQL database", async () => {
    const result = await db.execute<{
      hasActiveAttemptUrl: boolean;
      hasLease: boolean;
      hasRequestUrl: boolean;
      tableCount: number;
    }>(sql`
      select
        count(distinct table_name)::int as "tableCount",
        bool_or(
          table_name = 'webhook_deliveries' and column_name = 'active_attempt_url'
        ) as "hasActiveAttemptUrl",
        bool_or(
          table_name = 'webhook_deliveries' and column_name = 'locked_until'
        ) as "hasLease",
        bool_or(
          table_name = 'delivery_attempts' and column_name = 'request_url'
        ) as "hasRequestUrl"
      from information_schema.columns
      where table_schema = 'public'
    `);
    expect(result.rows[0]).toMatchObject({
      hasActiveAttemptUrl: true,
      hasLease: true,
      hasRequestUrl: true,
      tableCount: 17,
    });
  });

  test("migration initializes today's reservations and refuses excess endpoints without deleting them", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    await createWebhookEndpoint(workspace.slug, seeded.form.id, {
      name: "Existing",
      url: "https://receiver.example.org",
    });
    await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "before-migration",
      input: { versionId: seeded.version.id, values: { name: "Existing" } },
    });
    const resetLastMigration = async () => {
      await db.execute(sql`drop table usage_buckets`);
    };
    const replayUsageMigration = async () => {
      const source = await readFile(
        `${migrationsFolder}/0005_loving_lily_hollister.sql`,
        "utf8",
      );
      await db.transaction(async (tx) => {
        for (const statement of source.split("--> statement-breakpoint"))
          await tx.execute(sql.raw(statement));
      });
    };
    await resetLastMigration();
    await replayUsageMigration();
    expect(
      await db
        .select()
        .from(usageBuckets)
        .where(eq(usageBuckets.key, `submissions:${workspace.id}`)),
    ).toMatchObject([{ count: 1 }]);
    expect(
      await db
        .select()
        .from(usageBuckets)
        .where(eq(usageBuckets.key, `deliveries:${workspace.id}`)),
    ).toMatchObject([{ count: 1 }]);

    const extra = await db
      .insert(webhookEndpoints)
      .values(
        Array.from({ length: 5 }, () => ({
          formId: seeded.form.id,
          name: "Legacy",
          url: "https://receiver.example.org",
          secretCiphertext: encryptWebhookSecret("legacy"),
        })),
      )
      .returning({ id: webhookEndpoints.id });
    await resetLastMigration();
    try {
      await expect(replayUsageMigration()).rejects.toThrow();
      expect(
        await db
          .select()
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.formId, seeded.form.id)),
      ).toHaveLength(6);
    } finally {
      const last = extra[0];
      if (last)
        await db
          .update(webhookEndpoints)
          .set({ archivedAt: new Date() })
          .where(eq(webhookEndpoints.id, last.id));
      await replayUsageMigration();
    }
    expect(await db.select().from(submissions)).toHaveLength(1);
  });

  test("enforces request budgets atomically across concurrent callers and resets expired windows", async () => {
    await limitSubmitRequest("198.51.100.44");
    // Isolate concurrent counting from the real UTC minute boundary.
    await db
      .update(usageBuckets)
      .set({ count: 0, expiresAt: sql`now() + interval '1 hour'` });
    const results = await Promise.allSettled(
      Array.from({ length: 64 }, () => limitSubmitRequest("198.51.100.44")),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(60);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(4);
    const [bucket] = await db.select().from(usageBuckets);
    expect(bucket?.count).toBe(61);
    await db
      .update(usageBuckets)
      .set({ expiresAt: sql`now() - interval '1 second'` });
    await limitSubmitRequest("198.51.100.44");
    expect((await db.select().from(usageBuckets))[0]?.count).toBe(1);
    // Cleanup has a separate assertion; do not let the newly reset minute
    // expire between the reset assertion and the cleanup call.
    await db
      .update(usageBuckets)
      .set({ expiresAt: sql`now() + interval '1 hour'` });
    await removeExpiredUsage();
    expect(await db.select().from(usageBuckets)).toHaveLength(1);
    await db
      .update(usageBuckets)
      .set({ expiresAt: sql`now() - interval '1 second'` });
    await removeExpiredUsage();
    expect(await db.select().from(usageBuckets)).toHaveLength(0);
  });

  test("does not accept more endpoints than the cap under concurrent creation; archive frees capacity", async () => {
    const { user, workspace } = await seedWorkspace();
    const { form } = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        createWebhookEndpoint(workspace.slug, form.id, {
          name: `Endpoint ${index}`,
          url: "https://receiver.example.org/hook",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(MAX_WEBHOOK_ENDPOINTS);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(3);
    const [endpoint] = await db.select().from(webhookEndpoints);
    if (!endpoint) throw new Error("Missing endpoint");
    await updateWebhookEndpoint(workspace.slug, form.id, endpoint.id, {
      enabled: false,
    });
    await expect(
      createWebhookEndpoint(workspace.slug, form.id, {
        name: "Still full",
        url: "https://receiver.example.org/hook",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await archiveWebhookEndpoint(workspace.slug, form.id, endpoint.id);
    await expect(
      createWebhookEndpoint(workspace.slug, form.id, {
        name: "Replacement",
        url: "https://receiver.example.org/hook",
      }),
    ).resolves.toMatchObject({ enabled: true });
  });

  test("daily workspace quotas serialize across forms, preserve duplicates, and roll back submission plus outbox", async () => {
    const { user, workspace } = await seedWorkspace();
    const first = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    const second = await seedForm({
      workspaceId: workspace.id,
      userId: user.id,
    });
    if (!first.version || !second.version) throw new Error("Missing versions");
    await consumeUsage(
      db,
      `submissions:${workspace.id}`,
      MAX_DAILY_SUBMISSIONS,
      86400,
      MAX_DAILY_SUBMISSIONS - 1,
    );
    const submit = (
      form: Awaited<ReturnType<typeof seedForm>>,
      key: string,
    ) => {
      if (!form.version) throw new Error("Missing version");
      return receiveSubmission({
        slug: form.form.slug,
        idempotencyKey: key,
        input: { versionId: form.version.id, values: { name: "Quota" } },
      });
    };
    const results = await Promise.allSettled([
      submit(first, "first"),
      submit(second, "second"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await db.select().from(submissions)).toHaveLength(1);
    expect(await db.select().from(outboxEvents)).toHaveLength(1);
    const acceptedIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    await expect(
      submit(
        acceptedIndex === 0 ? first : second,
        acceptedIndex === 0 ? "first" : "second",
      ),
    ).resolves.toMatchObject({ duplicate: true });

    const other = await seedWorkspace();
    const otherForm = await seedForm({
      workspaceId: other.workspace.id,
      userId: other.user.id,
    });
    await createWebhookEndpoint(other.workspace.slug, otherForm.form.id, {
      name: "Hook",
      url: "https://receiver.example.org",
    });
    await consumeUsage(
      db,
      `deliveries:${other.workspace.id}`,
      MAX_DAILY_DELIVERIES,
      86400,
      MAX_DAILY_DELIVERIES,
    );
    await expect(
      submit(otherForm, "over-delivery-quota"),
    ).rejects.toMatchObject({ status: 429 });
    expect(await db.select().from(submissions)).toHaveLength(1);
    expect(await db.select().from(outboxEvents)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(usageBuckets)
        .where(eq(usageBuckets.key, `submissions:${other.workspace.id}`)),
    ).toHaveLength(0);
  });

  test("reports overdue outbox tasks without flagging scheduled future retries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await db.insert(outboxEvents).values([
        {
          aggregateId: crypto.randomUUID(),
          payload: {},
          type: "submission.received",
          availableAt: new Date(Date.now() - 20 * 60000),
        },
        {
          aggregateId: crypto.randomUUID(),
          payload: {},
          type: "delivery.requested",
          availableAt: new Date(Date.now() + 60000),
        },
      ]);
      expect(await inspectPipelineHealth()).toEqual({
        outbox: 1,
        deliveries: 0,
      });
      expect(warn).toHaveBeenCalledWith(expect.any(String), {
        outbox: 1,
        deliveries: 0,
      });
    } finally {
      warn.mockRestore();
    }
  });

  test("keeps idempotent submission and outbox persistence atomic", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    const version = seeded.version;
    if (!version) throw new Error("Expected a published version");
    const input = {
      values: { name: "Ada" },
      versionId: seeded.version.id,
    };

    const first = await receiveSubmission({
      idempotencyKey: "same-request",
      input,
      slug: seeded.form.slug,
    });
    const duplicate = await receiveSubmission({
      idempotencyKey: "same-request",
      input,
      slug: seeded.form.slug,
    });
    expect(duplicate).toEqual({ duplicate: true, id: first.id });

    const [submissionCount] = await db
      .select({ value: count() })
      .from(submissions);
    const [outboxCount] = await db
      .select({ value: count() })
      .from(outboxEvents);
    expect(submissionCount?.value).toBe(1);
    expect(outboxCount?.value).toBe(1);

    await db.execute(sql`
      alter table outbox_events
      add constraint reject_atomicity_test
      check (type <> 'submission.received') not valid
    `);
    try {
      await expect(
        receiveSubmission({
          idempotencyKey: "must-roll-back",
          input,
          slug: seeded.form.slug,
        }),
      ).rejects.toThrow();
      const [rolledBack] = await db
        .select({ value: count() })
        .from(submissions)
        .where(eq(submissions.idempotencyKey, "must-roll-back"));
      expect(rolledBack?.value).toBe(0);
    } finally {
      await db.execute(sql`
        alter table outbox_events drop constraint reject_atomicity_test
      `);
    }
  });

  test("treats JSONB values with reordered keys as an idempotent duplicate", async () => {
    const { user, workspace } = await seedWorkspace();
    const orderedSchema: FormSchemaV1 = {
      ...schema(),
      fields: [
        {
          id: crypto.randomUUID(),
          key: "z",
          label: "Z",
          required: true,
          type: "shortText",
          width: "full",
        },
        {
          id: crypto.randomUUID(),
          key: "a",
          label: "A",
          required: true,
          type: "shortText",
          width: "full",
        },
      ],
    };
    const seeded = await seedForm({
      formSchema: orderedSchema,
      userId: user.id,
      workspaceId: workspace.id,
    });
    const version = seeded.version;
    if (!version) throw new Error("Expected a published version");
    const input = {
      values: { z: "last", a: "first" },
      versionId: seeded.version.id,
    };

    const first = await receiveSubmission({
      idempotencyKey: "ordered-json",
      input,
      slug: seeded.form.slug,
    });
    await expect(
      receiveSubmission({
        idempotencyKey: "ordered-json",
        input,
        slug: seeded.form.slug,
      }),
    ).resolves.toEqual({ duplicate: true, id: first.id });
  });

  test("rate limits concurrent submissions by the server fingerprint", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");

    const results = await Promise.allSettled(
      Array.from({ length: 24 }, (_, index) =>
        receiveSubmission({
          fallbackFingerprint: "203.0.113.10",
          idempotencyKey: `rate-${index}`,
          input: {
            context: { visitorId: `rotated-${index}` },
            values: { name: "Ada" },
            versionId: seeded.version.id,
          },
          slug: seeded.form.slug,
        }),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(20);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof AppError &&
          result.reason.code === "RATE_LIMITED",
      ),
    ).toHaveLength(4);
  });

  test("scopes submission rate limits to one form", async () => {
    const { user, workspace } = await seedWorkspace();
    const first = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    const second = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!first.version || !second.version)
      throw new Error("Expected published versions");
    for (let index = 0; index < 20; index += 1) {
      await receiveSubmission({
        fallbackFingerprint: "203.0.113.20",
        idempotencyKey: `first-form-${index}`,
        input: { values: { name: "Ada" }, versionId: first.version.id },
        slug: first.form.slug,
      });
    }

    await expect(
      receiveSubmission({
        fallbackFingerprint: "203.0.113.20",
        idempotencyKey: "second-form",
        input: { values: { name: "Ada" }, versionId: second.version.id },
        slug: second.form.slug,
      }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  test("rejects a submission when archiving wins the form lock", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    let pendingSubmission: ReturnType<typeof receiveSubmission> | undefined;

    await db.transaction(async (tx) => {
      await tx
        .update(forms)
        .set({ archivedAt: new Date(), status: "archived" })
        .where(eq(forms.id, seeded.form.id));
      pendingSubmission = receiveSubmission({
        idempotencyKey: "archive-race",
        input: { values: { name: "Ada" }, versionId: seeded.version.id },
        slug: seeded.form.slug,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    await expect(pendingSubmission).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("snapshots active endpoint ids when the submission is accepted", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [firstEndpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "First",
        secretCiphertext: encryptWebhookSecret("first-secret"),
        url: "https://hooks.example.com/first",
      })
      .returning({ id: webhookEndpoints.id });
    if (!firstEndpoint) throw new Error("Could not seed endpoint");

    const submission = await receiveSubmission({
      idempotencyKey: "endpoint-snapshot",
      input: { values: { name: "Ada" }, versionId: seeded.version.id },
      slug: seeded.form.slug,
    });
    const [secondEndpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Second",
        secretCiphertext: encryptWebhookSecret("second-secret"),
        url: "https://hooks.example.com/second",
      })
      .returning({ id: webhookEndpoints.id });
    if (!secondEndpoint) throw new Error("Could not seed second endpoint");
    const [event] = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, submission.id));
    const endpointIds = Array.isArray(event?.payload.endpointIds)
      ? event.payload.endpointIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    await createDeliveriesForSubmission(submission.id, endpointIds);
    const deliveries = await db
      .select({ endpointId: webhookDeliveries.endpointId })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.submissionId, submission.id));
    expect(deliveries).toEqual([{ endpointId: firstEndpoint.id }]);
  });

  test("accepts a previously published version for an already-open form", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const nextSchema = { ...seeded.schema, title: "Version two" };
    const [nextVersion] = await db
      .insert(formVersions)
      .values({
        formId: seeded.form.id,
        publishedBy: user.id,
        schema: nextSchema,
        schemaHash: schemaHash(nextSchema),
        versionNumber: 2,
      })
      .returning({ id: formVersions.id });
    if (!nextVersion) throw new Error("Could not seed second version");
    await db
      .update(forms)
      .set({ publishedVersionId: nextVersion.id })
      .where(eq(forms.id, seeded.form.id));

    await expect(
      receiveSubmission({
        idempotencyKey: "old-published-version",
        input: { values: { name: "Ada" }, versionId: seeded.version.id },
        slug: seeded.form.slug,
      }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  test("rejects a version that does not belong to the submitted form", async () => {
    const { user, workspace } = await seedWorkspace();
    const first = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    const second = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!second.version) throw new Error("Expected a published version");

    await expect(
      receiveSubmission({
        idempotencyKey: "wrong-version",
        input: { values: { name: "Ada" }, versionId: second.version.id },
        slug: first.form.slug,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("serializes concurrent publication and enforces RBAC", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      published: false,
      userId: user.id,
      workspaceId: workspace.id,
    });
    const competingSchemas = [
      { ...seeded.schema, title: "First competing draft" },
      { ...seeded.schema, title: "Second competing draft" },
    ] satisfies FormSchemaV1[];
    const results = await Promise.allSettled([
      publishForm(workspace.slug, seeded.form.id, {
        expectedRevision: seeded.form.updatedAt.toISOString(),
        schema: competingSchemas[0],
      }),
      publishForm(workspace.slug, seeded.form.id, {
        expectedRevision: seeded.form.updatedAt.toISOString(),
        schema: competingSchemas[1],
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const publishedVersions = await db
      .select({ schema: formVersions.schema })
      .from(formVersions)
      .where(eq(formVersions.formId, seeded.form.id));
    expect(publishedVersions).toHaveLength(1);
    const successfulIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    expect(publishedVersions[0]?.schema).toEqual(
      competingSchemas[successfulIndex],
    );

    const [viewer] = await db
      .insert(users)
      .values({ email: `${crypto.randomUUID()}@example.com` })
      .returning({ id: users.id });
    if (!viewer) throw new Error("Could not seed viewer");
    await db.insert(memberships).values({
      role: "viewer",
      userId: viewer.id,
      workspaceId: workspace.id,
    });
    auth.userId = viewer.id;
    await expect(
      publishForm(workspace.slug, seeded.form.id, {
        expectedRevision: seeded.form.updatedAt.toISOString(),
        schema: seeded.schema,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("does not expose submissions across workspace boundaries", async () => {
    const first = await seedWorkspace();
    const second = await seedWorkspace();
    const seeded = await seedForm({
      userId: second.user.id,
      workspaceId: second.workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [submission] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "cross-workspace",
        normalizedValues: { name: "Private" },
        receivedValues: { name: "Private" },
        utm: {},
      })
      .returning({ id: submissions.id });
    if (!submission) throw new Error("Could not seed submission");
    auth.userId = first.user.id;

    await expect(
      listSubmissions({ workspaceSlug: second.workspace.slug }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getSubmissionDetail(first.workspace.slug, submission.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("restores an old version as a new draft without changing history", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    await db
      .update(forms)
      .set({
        draftSchema: { ...seeded.schema, title: "Changed draft" },
        name: "Changed draft",
      })
      .where(eq(forms.id, seeded.form.id));

    await restoreDraftFromVersion(
      workspace.slug,
      seeded.form.id,
      seeded.version.id,
      seeded.form.updatedAt.toISOString(),
    );
    const [restored] = await db
      .select({ draftSchema: forms.draftSchema })
      .from(forms)
      .where(eq(forms.id, seeded.form.id));
    const [immutableVersion] = await db
      .select({ schema: formVersions.schema })
      .from(formVersions)
      .where(eq(formVersions.id, seeded.version.id));
    expect(restored?.draftSchema).toEqual(seeded.schema);
    expect(immutableVersion?.schema).toEqual(seeded.schema);
  });

  test("paginates form versions in bounded pages", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    await db.insert(formVersions).values(
      Array.from({ length: 11 }, (_, index) => ({
        formId: seeded.form.id,
        publishedBy: user.id,
        schema: { ...seeded.schema, title: `Version ${index + 2}` },
        schemaHash: schemaHash({
          ...seeded.schema,
          title: `Version ${index + 2}`,
        }),
        versionNumber: index + 2,
      })),
    );

    const firstPage = await listFormVersions(workspace.slug, seeded.form.id);
    const secondPage = await listFormVersions(
      workspace.slug,
      seeded.form.id,
      firstPage.nextCursor ?? undefined,
    );

    expect(firstPage.data).toHaveLength(10);
    expect(firstPage.data[0]?.versionNumber).toBe(12);
    expect(firstPage.nextCursor).toBe(3);
    expect(secondPage.data.map((version) => version.versionNumber)).toEqual([
      2, 1,
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  test("prevents concurrent removal of all workspace owners", async () => {
    const { user, workspace } = await seedWorkspace();
    const [secondOwner] = await db
      .insert(users)
      .values({ email: `${crypto.randomUUID()}@example.com` })
      .returning({ id: users.id });
    if (!secondOwner) throw new Error("Could not seed second owner");
    await db.insert(memberships).values({
      role: "owner",
      userId: secondOwner.id,
      workspaceId: workspace.id,
    });

    const results = await Promise.allSettled([
      updateMember(workspace.slug, { role: "viewer", userId: user.id }),
      updateMember(workspace.slug, {
        role: "viewer",
        userId: secondOwner.id,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const [owners] = await db
      .select({ value: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspace.id),
          eq(memberships.role, "owner"),
        ),
      );
    expect(owners?.value).toBe(1);
  });

  test("claims an outbox event once and sends its deterministic id", async () => {
    const aggregateId = crypto.randomUUID();
    const [event] = await db
      .insert(outboxEvents)
      .values({
        aggregateId,
        payload: { submissionId: aggregateId },
        type: "submission.received",
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error("Could not seed outbox event");
    const sent: unknown[] = [];
    const sender = vi.fn(async (value: unknown) => {
      sent.push(value);
    });

    await Promise.all([
      dispatchPendingOutbox(1, sender),
      dispatchPendingOutbox(1, sender),
    ]);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sent[0]).toMatchObject({ id: event.id });
  });

  test("recovers an ingested submission whose consumer never completed", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Recovery receiver",
        url: "https://example.com/hook",
        secretCiphertext: encryptWebhookSecret("recovery-secret"),
      })
      .returning();
    if (!endpoint) throw new Error("Expected a recovery endpoint");
    const accepted = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "consumer-exhausted",
      input: { versionId: seeded.version.id, values: { name: "Recovered" } },
    });
    await dispatchPendingOutbox(1, async () => undefined);
    expect(await enqueueUnprocessedSubmissions()).toBe(0);
    await db
      .update(outboxEvents)
      .set({ sentAt: new Date(Date.now() - 6 * 60_000) });
    const [original] = await db.select().from(outboxEvents);
    const claims = await Promise.all([
      enqueueUnprocessedSubmissions(),
      enqueueUnprocessedSubmissions(),
    ]);
    expect(claims.reduce((sum, claimed) => sum + claimed, 0)).toBe(1);
    const [replacement] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.status, "pending"));
    expect(replacement?.id).not.toBe(original?.id);
    expect(replacement?.payload).toEqual(original?.payload);
    await dispatchPendingOutbox(1, async () => {
      const created = await Promise.all([
        createDeliveriesForSubmission(accepted.id, [endpoint.id]),
        createDeliveriesForSubmission(accepted.id, [endpoint.id]),
      ]);
      expect(created.reduce((sum, count) => sum + count, 0)).toBe(1);
    });
    expect(await enqueueUnprocessedSubmissions()).toBe(0);
    const deliveries = await db.select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0];
    if (!delivery) throw new Error("Expected a recovered delivery");
    await deliverWebhook(delivery.id, async () => ({
      ok: true,
      status: 200,
      responseExcerpt: "ok",
    }));
    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, accepted.id));
    expect(submission?.deliveryStatus).toBe("succeeded");
    expect(await enqueueUnprocessedSubmissions()).toBe(0);
    const events = await db
      .select()
      .from(submissionEvents)
      .where(eq(submissionEvents.type, "submission.processing_requeued"));
    expect(events).toHaveLength(1);
  });

  test("replays delivery creation without waiting on a completing delivery", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Receiver",
        url: "https://example.com/hook",
        secretCiphertext: encryptWebhookSecret("test-secret"),
      })
      .returning();
    if (!endpoint) throw new Error("Expected an endpoint");
    const accepted = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "creation-completion-race",
      input: { versionId: seeded.version.id, values: { name: "Ada" } },
    });
    await createDeliveriesForSubmission(accepted.id, [endpoint.id]);
    const [delivery] = await db.select().from(webhookDeliveries);
    if (!delivery) throw new Error("Expected a delivery");
    const initialOutbox = await db
      .select()
      .from(outboxEvents)
      .orderBy(outboxEvents.id);
    const initialEvents = await db
      .select()
      .from(submissionEvents)
      .orderBy(submissionEvents.id);

    let signalLocked = () => {};
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseCompletion = () => {};
    const release = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    const completion = db.transaction(async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set({ status: "succeeded" })
        .where(eq(webhookDeliveries.id, delivery.id));
      signalLocked();
      await release;
      await reconcileSubmissionDeliveryStatus(tx, accepted.id);
    });

    await locked;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const replay = Promise.all([
      createDeliveriesForSubmission(accepted.id, [endpoint.id]),
      createDeliveriesForSubmission(accepted.id, []),
      createDeliveriesForSubmission(accepted.id),
    ]);
    try {
      // The replay must finish before completion releases its delivery lock.
      expect(
        await Promise.race([
          replay,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Replay waited on the delivery lock")),
              2_000,
            );
          }),
        ]),
      ).toEqual([0, 0, 0]);
    } finally {
      clearTimeout(timer);
      releaseCompletion();
      await Promise.allSettled([completion, replay]);
    }
    await completion;
    const [finished] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, accepted.id));
    expect(finished?.deliveryStatus).toBe("succeeded");
    expect(await db.select().from(webhookDeliveries)).toMatchObject([
      { id: delivery.id, status: "succeeded" },
    ]);
    expect(
      await db.select().from(outboxEvents).orderBy(outboxEvents.id),
    ).toEqual(initialOutbox);
    expect(
      await db.select().from(submissionEvents).orderBy(submissionEvents.id),
    ).toEqual(initialEvents);
  });

  test("uses a fresh event ID for manual retry after an ingestion/ack crash", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Receiver",
        url: "https://example.com/hook",
        secretCiphertext: encryptWebhookSecret("test-secret"),
      })
      .returning();
    if (!endpoint) throw new Error("Expected an endpoint");
    const accepted = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "manual-crash",
      input: { versionId: seeded.version.id, values: { name: "Retry" } },
    });
    await createDeliveriesForSubmission(accepted.id, [endpoint.id]);
    const [delivery] = await db.select().from(webhookDeliveries);
    if (!delivery) throw new Error("Expected a delivery");
    await db
      .update(webhookDeliveries)
      .set({ status: "failed" })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db
      .update(outboxEvents)
      .set({
        status: "processing",
        availableAt: new Date(Date.now() + 5 * 60_000),
      })
      .where(eq(outboxEvents.aggregateId, delivery.id));
    const [oldEvent] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, delivery.id));
    await requestManualRetry(workspace.slug, delivery.id);
    const [retryEvent] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, delivery.id),
          eq(outboxEvents.status, "pending"),
        ),
      );
    expect(retryEvent?.id).not.toBe(oldEvent?.id);
    const seenIds = new Set([oldEvent?.id]);
    await dispatchPendingOutbox(100, async (event) => {
      if (
        event.name !== "form-forge/delivery.requested" ||
        seenIds.has(event.id)
      )
        return;
      seenIds.add(event.id);
      await deliverWebhook(delivery.id, async () => ({
        ok: true,
        status: 200,
        responseExcerpt: "ok",
      }));
    });
    const [finished] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(finished?.status).toBe("succeeded");
  });

  test("stops reclaiming an outbox event after its retry budget", async () => {
    const [event] = await db
      .insert(outboxEvents)
      .values({
        aggregateId: crypto.randomUUID(),
        attempts: 9,
        payload: {},
        type: "unsupported.event",
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error("Could not seed poison outbox event");
    const sender = vi.fn(async () => undefined);

    await dispatchPendingOutbox(1, sender);
    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvents.id, event.id));
    await dispatchPendingOutbox(1, sender);

    const [failed] = await db
      .select({ attempts: outboxEvents.attempts, status: outboxEvents.status })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));
    expect(failed).toMatchObject({ attempts: 10, status: "failed" });
    expect(sender).not.toHaveBeenCalled();
  });

  test("continues reclaiming supported outbox events after the poison budget", async () => {
    const aggregateId = crypto.randomUUID();
    const [event] = await db
      .insert(outboxEvents)
      .values({
        aggregateId,
        attempts: 10,
        payload: { submissionId: aggregateId },
        status: "failed",
        type: "submission.received",
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error("Could not seed retryable outbox event");
    const sender = vi.fn(async () => undefined);

    await dispatchPendingOutbox(1, sender);

    const [sent] = await db
      .select({ attempts: outboxEvents.attempts, status: outboxEvents.status })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));
    expect(sender).toHaveBeenCalledOnce();
    expect(sent).toMatchObject({ attempts: 11, status: "sent" });
  });

  test("records a visible submission event when dispatch repeatedly fails", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [submission] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "dispatch-failure",
        normalizedValues: { name: "Ada" },
        receivedValues: { name: "Ada" },
        utm: {},
      })
      .returning({ id: submissions.id });
    if (!submission) throw new Error("Could not seed submission");
    const [event] = await db
      .insert(outboxEvents)
      .values({
        aggregateId: submission.id,
        attempts: 9,
        payload: {},
        type: "submission.received",
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error("Could not seed outbox event");

    await dispatchPendingOutbox(1, async () => {
      throw new Error("Inngest is unavailable");
    });
    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvents.id, event.id));
    await dispatchPendingOutbox(1, async () => {
      throw new Error("Inngest is unavailable");
    });

    const dispatchFailures = await db
      .select({ data: submissionEvents.data, type: submissionEvents.type })
      .from(submissionEvents)
      .where(
        and(
          eq(submissionEvents.submissionId, submission.id),
          eq(submissionEvents.type, "delivery.dispatch_failed"),
        ),
      );
    expect(dispatchFailures).toEqual([
      {
        data: {
          attempts: 10,
          eventType: "submission.received",
        },
        type: "delivery.dispatch_failed",
      },
    ]);
  });

  test("manages webhook endpoint state and rotates its one-time secret", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Primary",
        secretCiphertext: encryptWebhookSecret("old-secret"),
        url: "https://hooks.example.com/form-forge",
      })
      .returning({ id: webhookEndpoints.id });
    if (!endpoint || !seeded.version)
      throw new Error("Could not seed webhook endpoint");
    const [submission] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "endpoint-lifecycle",
        normalizedValues: { name: "Ada" },
        receivedValues: { name: "Ada" },
        utm: {},
      })
      .returning({ id: submissions.id });
    if (!submission) throw new Error("Could not seed submission");
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({ endpointId: endpoint.id, submissionId: submission.id })
      .returning({ id: webhookDeliveries.id });
    if (!delivery) throw new Error("Could not seed delivery");

    const disabled = await updateWebhookEndpoint(
      workspace.slug,
      seeded.form.id,
      endpoint.id,
      { enabled: false, name: "Paused" },
    );
    expect(disabled).toMatchObject({ enabled: false, name: "Paused" });
    const [failedDelivery] = await db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(failedDelivery?.status).toBe("failed");
    const rotated = await rotateWebhookEndpointSecret(
      workspace.slug,
      seeded.form.id,
      endpoint.id,
    );
    expect(rotated.secret).not.toBe("old-secret");
    await archiveWebhookEndpoint(workspace.slug, seeded.form.id, endpoint.id);
    const [archived] = await db
      .select({
        archivedAt: webhookEndpoints.archivedAt,
        enabled: webhookEndpoints.enabled,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpoint.id));
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(archived?.enabled).toBe(false);
  });

  test("neutralizes spreadsheet formulas in CSV exports", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    await db.insert(submissions).values({
      formId: seeded.form.id,
      formVersionId: seeded.version.id,
      idempotencyKey: "csv-formula",
      normalizedValues: { name: '=HYPERLINK("https://example.com")' },
      receivedValues: { name: '=HYPERLINK("https://example.com")' },
      utm: {},
    });

    const csv = await new Response(
      await exportSubmissionsCsv(workspace.slug),
    ).text();
    expect(csv).toContain(`"'=HYPERLINK(""https://example.com"")"`);
  });

  test("exports only the submissions selected by form and delivery filters", async () => {
    const { user, workspace } = await seedWorkspace();
    const included = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    const excluded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!included.version || !excluded.version) {
      throw new Error("Expected published form versions");
    }
    await db.insert(submissions).values([
      {
        deliveryStatus: "succeeded",
        formId: included.form.id,
        formVersionId: included.version.id,
        idempotencyKey: "csv-included",
        normalizedValues: { name: "included-row" },
        receivedValues: { name: "included-row" },
        utm: {},
      },
      {
        deliveryStatus: "failed",
        formId: included.form.id,
        formVersionId: included.version.id,
        idempotencyKey: "csv-wrong-status",
        normalizedValues: { name: "wrong-status" },
        receivedValues: { name: "wrong-status" },
        utm: {},
      },
      {
        deliveryStatus: "succeeded",
        formId: excluded.form.id,
        formVersionId: excluded.version.id,
        idempotencyKey: "csv-wrong-form",
        normalizedValues: { name: "wrong-form" },
        receivedValues: { name: "wrong-form" },
        utm: {},
      },
    ]);

    const csv = await new Response(
      await exportSubmissionsCsv(workspace.slug, {
        deliveryStatus: "succeeded",
        formId: included.form.id,
      }),
    ).text();
    expect(csv).toContain("included-row");
    expect(csv).not.toContain("wrong-status");
    expect(csv).not.toContain("wrong-form");
  });

  test("freezes export membership, columns and statuses before streaming", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [original] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "snapshot-original",
        deliveryStatus: "succeeded",
        normalizedValues: { name: "original-value" },
        receivedValues: { name: "original-value" },
        utm: {},
      })
      .returning();
    if (!original) throw new Error("Expected a submission");
    const stream = await exportSubmissionsCsv(workspace.slug, {
      deliveryStatus: "succeeded",
    });
    await db
      .update(submissions)
      .set({ deliveryStatus: "failed" })
      .where(eq(submissions.id, original.id));
    await db.insert(submissions).values({
      formId: seeded.form.id,
      formVersionId: seeded.version.id,
      idempotencyKey: "snapshot-new",
      deliveryStatus: "succeeded",
      normalizedValues: { extra: "new-value" },
      receivedValues: { extra: "new-value" },
      utm: {},
    });
    const csv = await new Response(stream).text();
    expect(csv).toContain("original-value");
    expect(csv).toContain('"succeeded"');
    expect(csv).not.toContain("new-value");
    expect(csv).not.toContain('"extra"');
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });

  test("recovers an expired lease and completes failed then manual retry flow", async () => {
    const { workspace } = await seedWorkspace();
    const createdForm = await createForm(workspace.slug, "Pipeline form");
    const nextSchema = schema();
    const savedForm = await saveDraft(workspace.slug, createdForm.id, {
      expectedRevision: createdForm.updatedAt.toISOString(),
      schema: nextSchema,
    });
    const publishedVersion = await publishForm(workspace.slug, createdForm.id, {
      expectedRevision: savedForm.updatedAt.toISOString(),
      schema: nextSchema,
    });
    const secret = "integration-webhook-secret";
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: createdForm.id,
        name: "Primary",
        secretCiphertext: encryptWebhookSecret(secret),
        url: "https://hooks.example.com/form-forge",
      })
      .returning({ id: webhookEndpoints.id });
    if (!endpoint) throw new Error("Could not seed webhook endpoint");
    const submission = await receiveSubmission({
      idempotencyKey: "delivery-flow",
      input: { values: { name: "Ada" }, versionId: publishedVersion.id },
      slug: createdForm.slug,
    });
    await createDeliveriesForSubmission(submission.id);
    const [delivery] = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.submissionId, submission.id));
    if (!delivery) throw new Error("Could not seed delivery");

    await db
      .update(webhookDeliveries)
      .set({
        activeAttemptUrl: "https://hooks.example.com/form-forge",
        attemptCount: 1,
        leaseToken: crypto.randomUUID(),
        lockedUntil: new Date(Date.now() - 1_000),
        status: "processing",
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    await enqueueDueDeliveries();
    const [recovered] = await db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(recovered?.status).toBe("pending");
    const [expiredAttempt] = await db
      .select({
        errorCode: deliveryAttempts.errorCode,
        requestUrl: deliveryAttempts.requestUrl,
      })
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, delivery.id));
    expect(expiredAttempt?.errorCode).toBe("WORKER_LEASE_EXPIRED");
    expect(expiredAttempt?.requestUrl).toBe(
      "https://hooks.example.com/form-forge",
    );

    const httpFailure = vi.fn(async () => ({
      ok: false,
      responseExcerpt: "upstream failed",
      status: 503,
    }));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await db
        .update(webhookDeliveries)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(webhookDeliveries.id, delivery.id));
      await deliverWebhook(delivery.id, httpFailure);
    }
    const [failed] = await db
      .select({
        attemptCount: webhookDeliveries.attemptCount,
        status: webhookDeliveries.status,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(failed).toMatchObject({ attemptCount: 5, status: "failed" });

    await db
      .update(webhookEndpoints)
      .set({ url: "https://hooks.example.com/recovered" })
      .where(eq(webhookEndpoints.id, endpoint.id));
    await requestManualRetry(workspace.slug, delivery.id);
    const [retryEvent] = await db
      .select({ availableAt: outboxEvents.availableAt })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, delivery.id),
          eq(outboxEvents.type, "delivery.requested"),
        ),
      );
    expect(retryEvent?.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
    let deliveredBody = "";
    let deliveredHeaders: Record<string, string> = {};
    let deliveredUrl = "";
    await deliverWebhook(delivery.id, async (url, body, headers) => {
      deliveredUrl = url;
      deliveredBody = body;
      deliveredHeaders = headers;
      return { ok: true, responseExcerpt: "ok", status: 204 };
    });
    const expectedSignature = createHmac("sha256", secret)
      .update(`${deliveredHeaders["X-Form-Forge-Timestamp"]}.${deliveredBody}`)
      .digest("hex");
    expect(deliveredHeaders["X-Form-Forge-Signature"]).toBe(
      `v1=${expectedSignature}`,
    );
    expect(deliveredHeaders["X-Form-Forge-Id"]).toBe(delivery.id);
    expect(JSON.parse(deliveredBody)).toMatchObject({ id: delivery.id });
    expect(deliveredUrl).toBe("https://hooks.example.com/recovered");
    const [succeeded] = await db
      .select({
        attemptCount: webhookDeliveries.attemptCount,
        manualRetryCount: webhookDeliveries.manualRetryCount,
        status: webhookDeliveries.status,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(succeeded).toMatchObject({
      attemptCount: 6,
      manualRetryCount: 1,
      status: "succeeded",
    });
    const retryCompleted = await db
      .select({ type: submissionEvents.type })
      .from(submissionEvents)
      .where(
        and(
          eq(submissionEvents.submissionId, submission.id),
          eq(submissionEvents.type, "delivery.retry_completed"),
        ),
      );
    expect(retryCompleted).toHaveLength(1);
    const attemptDestinations = await db
      .select({ requestUrl: deliveryAttempts.requestUrl })
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, delivery.id));
    expect(attemptDestinations.map((attempt) => attempt.requestUrl)).toContain(
      "https://hooks.example.com/form-forge",
    );
    expect(attemptDestinations.map((attempt) => attempt.requestUrl)).toContain(
      "https://hooks.example.com/recovered",
    );
  });

  test("prioritizes the oldest due deliveries when the outbox batch is full", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    const version = seeded.version;
    if (!version) throw new Error("Expected a published version");
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Backlog",
        secretCiphertext: encryptWebhookSecret("backlog-secret"),
        url: "https://hooks.example.com/backlog",
      })
      .returning({ id: webhookEndpoints.id });
    if (!endpoint) throw new Error("Could not seed endpoint");
    const created = await db
      .insert(submissions)
      .values(
        Array.from({ length: 501 }, (_, index) => ({
          formId: seeded.form.id,
          formVersionId: version.id,
          idempotencyKey: `backlog-${index}`,
          normalizedValues: { name: "Ada" },
          receivedValues: { name: "Ada" },
          utm: {},
        })),
      )
      .returning({ id: submissions.id });
    const oldestSubmission = created[500];
    if (!oldestSubmission) throw new Error("Could not seed backlog submission");
    const dueAt = new Date(Date.now() - 60_000);
    const deliveries = await db
      .insert(webhookDeliveries)
      .values(
        created.map((submission, index) => ({
          endpointId: endpoint.id,
          nextAttemptAt:
            index === 500 ? new Date(Date.now() - 60 * 60_000) : dueAt,
          submissionId: submission.id,
        })),
      )
      .returning({
        id: webhookDeliveries.id,
        submissionId: webhookDeliveries.submissionId,
      });
    const oldestDelivery = deliveries.find(
      (delivery) => delivery.submissionId === oldestSubmission.id,
    );
    if (!oldestDelivery) throw new Error("Could not find oldest delivery");

    await enqueueDueDeliveries();

    const enqueued = await db
      .select({ aggregateId: outboxEvents.aggregateId })
      .from(outboxEvents)
      .where(eq(outboxEvents.type, "delivery.requested"));
    expect(enqueued).toHaveLength(500);
    expect(enqueued.map((event) => event.aggregateId)).toContain(
      oldestDelivery.id,
    );
  });

  test("records webhook timeouts as retryable attempts", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Timeout",
        secretCiphertext: encryptWebhookSecret("timeout-secret"),
        url: "https://hooks.example.com/timeout",
      })
      .returning({ id: webhookEndpoints.id });
    const [submission] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "timeout",
        normalizedValues: { name: "Ada" },
        receivedValues: { name: "Ada" },
        utm: {},
      })
      .returning({ id: submissions.id });
    if (!endpoint || !submission)
      throw new Error("Could not seed timeout delivery");
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({ endpointId: endpoint.id, submissionId: submission.id })
      .returning({ id: webhookDeliveries.id });
    if (!delivery) throw new Error("Could not seed timeout delivery");

    await deliverWebhook(delivery.id, async () => {
      const error = new Error("Webhook request timed out");
      error.name = "TimeoutError";
      throw error;
    });
    const [attempt] = await db
      .select({ errorCode: deliveryAttempts.errorCode })
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, delivery.id));
    expect(attempt?.errorCode).toBe("TIMEOUT");
  });

  test("reconciles the submission after concurrent delivery completion", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const endpoints = await db
      .insert(webhookEndpoints)
      .values(
        ["First", "Second"].map((name) => ({
          formId: seeded.form.id,
          name,
          secretCiphertext: encryptWebhookSecret(`${name}-secret`),
          url: `https://hooks.example.com/${name.toLowerCase()}`,
        })),
      )
      .returning({ id: webhookEndpoints.id });
    const [submission] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "concurrent-deliveries",
        normalizedValues: { name: "Ada" },
        receivedValues: { name: "Ada" },
        utm: {},
      })
      .returning({ id: submissions.id });
    if (!submission) throw new Error("Could not seed submission");
    const deliveries = await db
      .insert(webhookDeliveries)
      .values(
        endpoints.map((endpoint) => ({
          endpointId: endpoint.id,
          submissionId: submission.id,
        })),
      )
      .returning({ id: webhookDeliveries.id });
    let arrived = 0;
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = async () => {
      arrived += 1;
      if (arrived === deliveries.length) release?.();
      await barrier;
      return { ok: true, responseExcerpt: "ok", status: 204 };
    };

    await Promise.all(
      deliveries.map((delivery) => deliverWebhook(delivery.id, transport)),
    );
    const [completed] = await db
      .select({ deliveryStatus: submissions.deliveryStatus })
      .from(submissions)
      .where(eq(submissions.id, submission.id));
    expect(completed?.deliveryStatus).toBe("succeeded");
  });

  test("terminalizes disabled endpoints and blocks manual retry", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        enabled: false,
        formId: seeded.form.id,
        name: "Disabled",
        secretCiphertext: encryptWebhookSecret("disabled-secret"),
        url: "https://hooks.example.com/disabled",
      })
      .returning({ id: webhookEndpoints.id });
    const [submission] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "disabled-endpoint",
        normalizedValues: { name: "Ada" },
        receivedValues: { name: "Ada" },
        utm: {},
      })
      .returning({ id: submissions.id });
    if (!endpoint || !submission) throw new Error("Could not seed delivery");
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({ endpointId: endpoint.id, submissionId: submission.id })
      .returning({ id: webhookDeliveries.id });
    if (!delivery) throw new Error("Could not seed delivery");
    const transport = vi.fn();

    await deliverWebhook(delivery.id, transport);
    expect(transport).not.toHaveBeenCalled();
    const [failed] = await db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id));
    expect(failed?.status).toBe("failed");
    await expect(
      requestManualRetry(workspace.slug, delivery.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("records secret decryption failures without waiting for lease expiry", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: seeded.form.id,
        name: "Broken secret",
        secretCiphertext: "invalid-ciphertext",
        url: "https://hooks.example.com/broken",
      })
      .returning({ id: webhookEndpoints.id });
    const [submission] = await db
      .insert(submissions)
      .values({
        formId: seeded.form.id,
        formVersionId: seeded.version.id,
        idempotencyKey: "broken-secret",
        normalizedValues: { name: "Ada" },
        receivedValues: { name: "Ada" },
        utm: {},
      })
      .returning({ id: submissions.id });
    if (!endpoint || !submission) throw new Error("Could not seed delivery");
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({ endpointId: endpoint.id, submissionId: submission.id })
      .returning({ id: webhookDeliveries.id });
    if (!delivery) throw new Error("Could not seed delivery");

    await deliverWebhook(delivery.id, vi.fn());
    const [attempt] = await db
      .select({ errorCode: deliveryAttempts.errorCode })
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, delivery.id));
    expect(attempt?.errorCode).toBe("CONFIGURATION_ERROR");
  });
  test("new forms default to private metadata and direct API input cannot bypass it", async () => {
    const { user, workspace } = await seedWorkspace();
    const created = await createForm(workspace.slug, "Private form");
    expect(created.collectMetadata).toBe(false);
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
      collectMetadata: false,
    });
    if (!seeded.version) throw new Error("Missing version");
    const direct = await submitRoute(
      new Request(
        `http://localhost:3000/api/forms/${seeded.form.slug}/submit`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": "direct-private",
            "User-Agent": "direct-agent",
          },
          body: JSON.stringify({
            versionId: seeded.version.id,
            values: { name: "Direct API" },
            context: {
              visitorId: "direct-visitor",
              referrer: "https://direct.example",
              utm: { utm_source: "direct" },
            },
          }),
        },
      ),
      { params: Promise.resolve({ slug: seeded.form.slug }) },
    );
    expect(direct.status).toBe(201);
    const directId = (await direct.json()).data.submissionId;
    expect(
      await db.select().from(submissions).where(eq(submissions.id, directId)),
    ).toMatchObject([
      { fingerprintHash: null, userAgent: null, referrer: null, utm: {} },
    ]);
    const response = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "private",
      fallbackFingerprint: "203.0.113.5",
      userAgent: "private-agent",
      input: {
        versionId: seeded.version.id,
        values: { name: "Ada" },
        context: {
          visitorId: "persistent-visitor",
          referrer: "https://example.com",
          utm: { utm_source: "private" },
        },
      },
    });
    const [saved] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, response.id));
    expect(saved).toMatchObject({
      fingerprintHash: null,
      userAgent: null,
      referrer: null,
      utm: {},
    });
    const markers = await db
      .select()
      .from(usageBuckets)
      .where(sql`key like 'spam:%'`);
    expect(markers).toHaveLength(2);
    expect(JSON.stringify(markers)).not.toContain("203.0.113.5");
    expect(JSON.stringify(markers)).not.toContain(response.id);
    await db.update(usageBuckets).set({ expiresAt: new Date(0) });
    await removeExpiredUsage();
    expect(await db.select().from(usageBuckets)).toHaveLength(0);
  });

  test("disabled metadata still enforces the rolling anti-spam budget under concurrency", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
      collectMetadata: false,
    });
    if (!seeded.version) throw new Error("Missing version");
    const versionId = seeded.version.id;
    const results = await Promise.allSettled(
      Array.from({ length: 22 }, (_, index) =>
        receiveSubmission({
          slug: seeded.form.slug,
          fallbackFingerprint: "203.0.113.6",
          idempotencyKey: `private-${index}`,
          input: { versionId, values: { name: "Ada" } },
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(20);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" && result.reason.code === "RATE_LIMITED",
      ),
    ).toHaveLength(2);
    expect(
      (await db.select().from(submissions)).every(
        (row) => row.fingerprintHash === null,
      ),
    ).toBe(true);
  });

  test("fast dispatch survives an Inngest outage and cron races without duplicate logical events", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const input = { versionId: seeded.version.id, values: { name: "Ada" } };
    const first = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "fast",
      input,
    });
    const backlog = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "backlog",
      input,
    });
    const spy = vi
      .spyOn(inngest, "send")
      .mockRejectedValue(new Error("scheduler offline"));
    try {
      expect(await dispatchSubmissionOutbox(first.id)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(await db.select().from(submissions)).toHaveLength(2);
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, first.id)),
    ).toMatchObject([{ status: "failed", attempts: 1 }]);
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, backlog.id)),
    ).toMatchObject([{ status: "pending", attempts: 0 }]);
    await db.update(outboxEvents).set({ availableAt: new Date(0) });
    const sender = vi.fn(async () => undefined);
    await Promise.all([
      dispatchPendingOutbox(1, sender, [first.id]),
      dispatchPendingOutbox(50, sender),
    ]);
    expect(sender).toHaveBeenCalledTimes(2);
    const eventIds = sender.mock.calls.map(
      (call) => (call as unknown as [{ id: string }])[0].id,
    );
    expect(new Set(eventIds).size).toBe(2);
    await Promise.all([
      createDeliveriesForSubmission(first.id),
      createDeliveriesForSubmission(first.id),
    ]);
    expect(
      await db
        .select()
        .from(submissionEvents)
        .where(eq(submissionEvents.type, "delivery.not_configured")),
    ).toHaveLength(1);
  });

  test("the second-stage fast path dispatches only the new submission's deliveries", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    await createWebhookEndpoint(workspace.slug, seeded.form.id, {
      name: "Receiver",
      url: "https://receiver.example.org",
    });
    const first = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "second-stage",
      input: { versionId: seeded.version.id, values: { name: "Ada" } },
    });
    await dispatchPendingOutbox(1, async () => undefined, [first.id]);
    await createDeliveriesForSubmission(first.id);
    const sender = vi.spyOn(inngest, "send").mockResolvedValue({ ids: [] });
    try {
      expect(await dispatchSubmissionOutbox(first.id)).toBe(1);
      expect(sender).toHaveBeenCalledOnce();
    } finally {
      sender.mockRestore();
    }
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.type, "delivery.requested")),
    ).toMatchObject([{ status: "sent" }]);
  });

  test("admission serializes the last place, preserves duplicates, and closes old versions immediately", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const originalVersion = seeded.version.id;
    const [policy] = await db
      .select()
      .from(forms)
      .where(eq(forms.id, seeded.form.id));
    if (!policy) throw new Error("Missing form");
    await updateFormPolicy(workspace.slug, seeded.form.id, {
      expectedRevision: policy.policyUpdatedAt.toISOString(),
      policy: {
        collectMetadata: false,
        paused: false,
        closesAt: null,
        maxAccepted: 1,
        closedMessage: "All places taken",
      },
    });
    const input = { versionId: originalVersion, values: { name: "Ada" } };
    const results = await Promise.allSettled(
      ["last-a", "last-b"].map((idempotencyKey) =>
        receiveSubmission({ slug: seeded.form.slug, idempotencyKey, input }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason.message === "All places taken",
      ),
    ).toHaveLength(1);
    const [saved] = await db.select().from(submissions);
    if (!saved) throw new Error("Missing response");
    expect(
      await receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: saved.idempotencyKey,
        input,
      }),
    ).toMatchObject({ duplicate: true });
    await deleteSubmission(workspace.slug, saved.id, saved.id);
    expect(
      await db.select().from(forms).where(eq(forms.id, seeded.form.id)),
    ).toMatchObject([{ acceptedCount: 1 }]);
    await expect(
      receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: "still-full",
        input,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await db
      .update(forms)
      .set({ maxAccepted: null, paused: true, closedMessage: "Paused" })
      .where(eq(forms.id, seeded.form.id));
    const newerSchema = { ...seeded.schema, title: "New version" };
    await publishForm(workspace.slug, seeded.form.id, {
      expectedRevision: seeded.form.updatedAt.toISOString(),
      schema: newerSchema,
    });
    await expect(
      receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: "old-tab-paused",
        input,
      }),
    ).rejects.toMatchObject({ message: "Paused" });
    await db
      .update(forms)
      .set({ paused: false, closesAt: new Date(Date.now() - 1_000) })
      .where(eq(forms.id, seeded.form.id));
    await expect(
      receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: "old-tab-timed",
        input,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await db
      .update(forms)
      .set({ closesAt: null })
      .where(eq(forms.id, seeded.form.id));
    expect(
      await receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: "old-tab-resumed",
        input,
      }),
    ).toMatchObject({ duplicate: false });
    expect(
      (await getPublishedForm(seeded.form.slug, originalVersion)).version
        .schema,
    ).toEqual(seeded.schema);
  });

  test("deletion atomically removes associated data, retains endpoints, quotas and minimal expiring tombstones", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    await createWebhookEndpoint(workspace.slug, seeded.form.id, {
      name: "Receiver",
      url: "https://receiver.example.org",
    });
    const input = {
      versionId: seeded.version.id,
      values: { name: "Sensitive value" },
    };
    const saved = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "sensitive-key",
      input,
    });
    await createDeliveriesForSubmission(saved.id);
    const [delivery] = await db.select().from(webhookDeliveries);
    if (!delivery) throw new Error("Missing delivery");
    await deliverWebhook(delivery.id, async () => ({
      ok: true,
      status: 200,
      responseExcerpt: "ok",
    }));
    const usage = await db.select().from(usageBuckets);
    await expect(
      deleteSubmission(workspace.slug, saved.id, "wrong"),
    ).rejects.toMatchObject({ status: 422 });
    await db.execute(
      sql`alter table audit_logs add constraint reject_delete_audit check (action <> 'submission.deleted')`,
    );
    try {
      await expect(
        deleteSubmission(workspace.slug, saved.id, saved.id),
      ).rejects.toThrow();
      expect(await db.select().from(submissions)).toHaveLength(1);
      expect(await db.select().from(deliveryAttempts)).toHaveLength(1);
      expect(await db.select().from(deletedSubmissionKeys)).toHaveLength(0);
    } finally {
      await db.execute(
        sql`alter table audit_logs drop constraint reject_delete_audit`,
      );
    }
    await deleteSubmission(workspace.slug, saved.id, saved.id);
    expect(await db.select().from(submissions)).toHaveLength(0);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
    expect(await db.select().from(deliveryAttempts)).toHaveLength(0);
    expect(await db.select().from(submissionEvents)).toHaveLength(0);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
    expect(await db.select().from(webhookEndpoints)).toHaveLength(1);
    expect(await db.select().from(usageBuckets)).toEqual(usage);
    const tombstones = await db.select().from(deletedSubmissionKeys);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]?.keyHash).toMatch(/^[a-f0-9]{64}$/);
    const remaining = JSON.stringify([
      ...tombstones,
      ...(await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "submission.deleted"))),
    ]);
    expect(remaining).not.toContain("Sensitive value");
    expect(remaining).not.toContain("sensitive-key");
    await expect(
      receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: "sensitive-key",
        input,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("deleted"),
    });
    await db.update(deletedSubmissionKeys).set({ expiresAt: new Date(0) });
    await removeExpiredUsage();
    expect(await db.select().from(deletedSubmissionKeys)).toHaveLength(0);
    expect(
      await receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: "sensitive-key",
        input,
      }),
    ).toMatchObject({ duplicate: false });
  });

  test("deletion conflicts with delivery creation and in-flight HTTP, then succeeds after locks and leases release", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    await createWebhookEndpoint(workspace.slug, seeded.form.id, {
      name: "Receiver",
      url: "https://receiver.example.org",
    });
    const saved = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "delete-race",
      input: { versionId: seeded.version.id, values: { name: "Ada" } },
    });
    await db.transaction(async (tx) => {
      await tx
        .select()
        .from(submissions)
        .where(eq(submissions.id, saved.id))
        .for("update");
      await expect(
        deleteSubmission(workspace.slug, saved.id, saved.id),
      ).rejects.toMatchObject({ status: 409 });
      // Deletion's form lock must have rolled back before the error is returned.
      await tx
        .select()
        .from(forms)
        .where(eq(forms.id, seeded.form.id))
        .for("update", { noWait: true });
    });
    await createDeliveriesForSubmission(saved.id);
    const [delivery] = await db.select().from(webhookDeliveries);
    if (!delivery) throw new Error("Missing delivery");
    let release!: () => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = deliverWebhook(delivery.id, async () => {
      started();
      await gate;
      return { ok: true, status: 200, responseExcerpt: "ok" };
    });
    await start;
    try {
      await expect(
        deleteSubmission(workspace.slug, saved.id, saved.id),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      release();
      await sending;
    }
    await deleteSubmission(workspace.slug, saved.id, saved.id);
    await expect(createDeliveriesForSubmission(saved.id)).rejects.toMatchObject(
      { status: 404 },
    );
    expect(await db.select().from(submissions)).toHaveLength(0);
  });

  test("deletion conflicts with cron between due selection and outbox insertion, then retries without orphan work", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    await createWebhookEndpoint(workspace.slug, seeded.form.id, {
      name: "Receiver",
      url: "https://receiver.example.org",
    });
    const saved = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "delete-cron-race",
      input: { versionId: seeded.version.id, values: { name: "Ada" } },
    });
    await createDeliveriesForSubmission(saved.id);
    const [delivery] = await db.select().from(webhookDeliveries);
    if (!delivery) throw new Error("Missing delivery");
    await db
      .delete(outboxEvents)
      .where(eq(outboxEvents.aggregateId, delivery.id));

    // Hold a test-only advisory lock at INSERT, after the real cron service has
    // selected its due rows. No timers or production hooks choose the ordering.
    await db.execute(sql`
      create function test_gate_outbox_insert() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(871204, 1);
        return NEW;
      end;
      $$
    `);
    await db.execute(sql`
      create trigger test_gate_outbox_insert before insert on outbox_events
      for each row execute function test_gate_outbox_insert()
    `);
    let recovery: Promise<PromiseSettledResult<number>[]> | undefined;
    try {
      await db.transaction(async (guard) => {
        await guard.execute(sql`select pg_advisory_xact_lock(871204, 1)`);
        recovery = Promise.allSettled([enqueueDueDeliveries()]);
        await expect
          .poll(async () => {
            const waiting = await db.execute<{ count: number }>(sql`
              select count(*)::int as count from pg_locks
              where locktype = 'advisory' and not granted
                and classid = 871204 and objid = 1
                and database = (select oid from pg_database where datname = current_database())
            `);
            return waiting.rows[0]?.count;
          })
          .toBe(1);
        await expect(
          deleteSubmission(workspace.slug, saved.id, saved.id),
        ).rejects.toMatchObject({ status: 409 });
        expect(await db.select().from(deletedSubmissionKeys)).toHaveLength(0);
        // A failed deletion must release its earlier form/submission locks.
        await guard
          .select()
          .from(forms)
          .where(eq(forms.id, seeded.form.id))
          .for("update", { noWait: true });
        await guard
          .select()
          .from(submissions)
          .where(eq(submissions.id, saved.id))
          .for("update", { noWait: true });
      });
      expect(await recovery).toEqual([{ status: "fulfilled", value: 1 }]);
      await deleteSubmission(workspace.slug, saved.id, saved.id);
      expect(await db.select().from(submissions)).toHaveLength(0);
      expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
      expect(await db.select().from(outboxEvents)).toHaveLength(0);
      expect(await enqueueDueDeliveries()).toBe(0);
      expect(await db.select().from(outboxEvents)).toHaveLength(0);
    } finally {
      await recovery;
      await db.execute(
        sql`drop trigger test_gate_outbox_insert on outbox_events`,
      );
      await db.execute(sql`drop function test_gate_outbox_insert()`);
    }
  });

  test("processing updates preserve immutable values and enforce roles and workspace isolation", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const saved = await receiveSubmission({
      slug: seeded.form.slug,
      idempotencyKey: "status",
      input: { versionId: seeded.version.id, values: { name: "Original" } },
    });
    const [before] = await db.select().from(submissions);
    await db
      .update(memberships)
      .set({ role: "viewer" })
      .where(eq(memberships.userId, user.id));
    expect(
      (await getSubmissionDetail(workspace.slug, saved.id)).submission
        .processingStatus,
    ).toBe("new");
    await expect(
      updateSubmissionStatus(workspace.slug, saved.id, {
        processingStatus: "processed",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      deleteSubmission(workspace.slug, saved.id, saved.id),
    ).rejects.toMatchObject({ status: 403 });
    await db
      .update(memberships)
      .set({ role: "editor" })
      .where(eq(memberships.userId, user.id));
    await updateSubmissionStatus(workspace.slug, saved.id, {
      processingStatus: "processed",
    });
    await expect(
      updateSubmissionStatus(workspace.slug, saved.id, {
        processingStatus: "new",
        receivedValues: { name: "Changed" },
      }),
    ).rejects.toThrow();
    await expect(
      deleteSubmission(workspace.slug, saved.id, saved.id),
    ).rejects.toMatchObject({ status: 403 });
    const [after] = await db.select().from(submissions);
    expect(after).toEqual({ ...before, processingStatus: "processed" });
    const other = await seedWorkspace();
    await expect(
      updateSubmissionStatus(other.workspace.slug, saved.id, {
        processingStatus: "new",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteSubmission(other.workspace.slug, saved.id, saved.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await listSubmissions({ workspaceSlug: other.workspace.slug })).data,
    ).toHaveLength(0);
  });

  test("date, text and processing filters select the same bounded rows in the list and CSV", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const accepted = [];
    for (const name of ["Alpha target", "Beta target", "Alpha elsewhere"]) {
      accepted.push(
        await receiveSubmission({
          slug: seeded.form.slug,
          idempotencyKey: name,
          input: { versionId: seeded.version.id, values: { name } },
        }),
      );
    }
    const selected = accepted[0];
    if (!selected) throw new Error("Missing response");
    await db
      .update(submissions)
      .set({
        createdAt: new Date("2026-10-01T12:00:00Z"),
        processingStatus: "processed",
      })
      .where(eq(submissions.id, selected.id));
    const filters = {
      from: "2026-10-01T00:00:00Z",
      until: "2026-10-02T00:00:00Z",
      q: "alpha target",
      processingStatus: "processed" as const,
    };
    const list = await listSubmissions({
      workspaceSlug: workspace.slug,
      ...filters,
      limit: 1,
    });
    expect(list.data.map((row) => row.id)).toEqual([selected.id]);
    expect(list.nextCursor).toBeNull();
    const csv = await new Response(
      await exportSubmissionsCsv(workspace.slug, filters),
    ).text();
    expect(csv).toContain(selected.id);
    for (const excluded of accepted.slice(1))
      expect(csv).not.toContain(excluded.id);
    expect(csv.split("\r\n")[0]).toBe(
      '"submission_id","form","version","received_at","delivery_status","name","processing_status"',
    );
    await expect(
      listSubmissions({ workspaceSlug: workspace.slug, q: "x".repeat(101) }),
    ).rejects.toThrow();
    await expect(
      exportSubmissionsCsv(workspace.slug, { ...filters, until: filters.from }),
    ).rejects.toThrow();
  });
  test("concurrent retries with the same key consume one last place and a single usage reservation", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    await db
      .update(forms)
      .set({ maxAccepted: 1 })
      .where(eq(forms.id, seeded.form.id));
    const request = {
      slug: seeded.form.slug,
      idempotencyKey: "same-last-place",
      input: { versionId: seeded.version.id, values: { name: "One" } },
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => receiveSubmission(request)),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(
      await db.select().from(forms).where(eq(forms.id, seeded.form.id)),
    ).toMatchObject([{ acceptedCount: 1 }]);
    expect(
      await db
        .select()
        .from(usageBuckets)
        .where(eq(usageBuckets.key, `submissions:${workspace.id}`)),
    ).toMatchObject([{ count: 1 }]);
  });

  test("closure uses the database clock after waiting for the admission lock", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const input = {
      versionId: seeded.version.id,
      values: { name: "Too late" },
    };
    let pending: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`update forms set closes_at = clock_timestamp() + interval '20 milliseconds' where id = ${seeded.form.id}`,
      );
      pending = receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: "waited-past-close",
        input,
      }).catch((error: unknown) => error);
      await tx.execute(sql`select pg_sleep(0.05)`);
    });
    expect(await pending).toMatchObject({ status: 409 });
    expect(await db.select().from(submissions)).toHaveLength(0);
  });

  test("intake policy changes use workspace roles and a separate optimistic revision", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    const [form] = await db
      .select()
      .from(forms)
      .where(eq(forms.id, seeded.form.id));
    if (!form) throw new Error("Missing form");
    const input = {
      expectedRevision: form.policyUpdatedAt.toISOString(),
      policy: {
        collectMetadata: false,
        paused: true,
        closesAt: "2027-01-01T03:00:00+03:00",
        maxAccepted: 10,
        closedMessage: "Closed",
      },
    };
    await db
      .update(memberships)
      .set({ role: "viewer" })
      .where(eq(memberships.userId, user.id));
    await expect(
      updateFormPolicy(workspace.slug, form.id, input),
    ).rejects.toMatchObject({ status: 403 });
    await db
      .update(memberships)
      .set({ role: "editor" })
      .where(eq(memberships.userId, user.id));
    const updated = await updateFormPolicy(workspace.slug, form.id, input);
    expect(updated?.closesAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(updated?.updatedAt).toEqual(form.updatedAt);
    expect(updated?.draftSchema).toEqual(form.draftSchema);
    await expect(
      updateFormPolicy(workspace.slug, form.id, input),
    ).rejects.toMatchObject({ status: 409 });
    const other = await seedWorkspace();
    await expect(
      updateFormPolicy(other.workspace.slug, form.id, input),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("delivery creation racing deletion cannot leave orphaned deliveries or outbox work", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Missing version");
    const input = { versionId: seeded.version.id, values: { name: "Race" } };
    await createWebhookEndpoint(workspace.slug, seeded.form.id, {
      name: "Receiver",
      url: "https://receiver.example.org",
    });
    for (let index = 0; index < 5; index += 1) {
      const saved = await receiveSubmission({
        slug: seeded.form.slug,
        idempotencyKey: `creation-race-${index}`,
        input,
      });
      const results = await Promise.allSettled([
        createDeliveriesForSubmission(saved.id),
        deleteSubmission(workspace.slug, saved.id, saved.id),
      ]);
      const deletion = results[1];
      if (deletion?.status === "rejected") {
        expect(deletion.reason).toMatchObject({ status: 409 });
        await deleteSubmission(workspace.slug, saved.id, saved.id);
      }
      expect(
        await db.select().from(submissions).where(eq(submissions.id, saved.id)),
      ).toHaveLength(0);
    }
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
    expect(await db.select().from(webhookEndpoints)).toHaveLength(1);
  });
});

test("integration suite documents its isolated database requirement", () => {
  if (!process.env.TEST_DATABASE_URL) {
    expect(AppError).toBeDefined();
  }
});
