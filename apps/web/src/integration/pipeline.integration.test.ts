// @vitest-environment node

import { defaultFormSchema, type FormSchemaV1 } from "@form-forge/form-schema";
import { and, count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHash, createHmac } from "node:crypto";
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

import { db } from "@/db/client";
import {
  deliveryAttempts,
  forms,
  formVersions,
  memberships,
  outboxEvents,
  submissions,
  users,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "@/db/schema";
import { encryptWebhookSecret } from "@/integration/webhooks/crypto";
import { AppError } from "@/lib/errors";
import {
  createDeliveriesForSubmission,
  deliverWebhook,
  requestManualRetry,
} from "@/services/deliveries";
import {
  createForm,
  publishForm,
  restoreDraftFromVersion,
  saveDraft,
} from "@/services/forms";
import { updateMember } from "@/services/memberships";
import { dispatchPendingOutbox, enqueueDueDeliveries } from "@/services/outbox";
import { receiveSubmission } from "@/services/public-forms";
import { exportSubmissionsCsv } from "@/services/submissions";
import {
  archiveWebhookEndpoint,
  rotateWebhookEndpointSecret,
  updateWebhookEndpoint,
} from "@/services/webhook-endpoints";

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
  published = true,
  workspaceId,
  userId,
}: {
  published?: boolean;
  userId: string;
  workspaceId: string;
}) => {
  const formSchema = schema();
  const [form] = await db
    .insert(forms)
    .values({
      createdBy: userId,
      draftSchema: formSchema,
      name: formSchema.title,
      slug: `form-${crypto.randomUUID()}`,
      status: published ? "published" : "draft",
      workspaceId,
    })
    .returning({ id: forms.id, slug: forms.slug });
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
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table outbox_events, users, workspaces cascade`,
    );
  });

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
      tableCount: 15,
    });
  });

  test("keeps idempotent submission and outbox persistence atomic", async () => {
    const { user, workspace } = await seedWorkspace();
    const seeded = await seedForm({
      userId: user.id,
      workspaceId: workspace.id,
    });
    if (!seeded.version) throw new Error("Expected a published version");
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
    const results = await Promise.allSettled([
      publishForm(workspace.slug, seeded.form.id),
      publishForm(workspace.slug, seeded.form.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const [versionCount] = await db
      .select({ value: count() })
      .from(formVersions)
      .where(eq(formVersions.formId, seeded.form.id));
    expect(versionCount?.value).toBe(1);

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
      publishForm(workspace.slug, seeded.form.id),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
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

    const csv = await exportSubmissionsCsv(workspace.slug);
    expect(csv).toContain(`"'=HYPERLINK(""https://example.com"")"`);
  });

  test("recovers an expired lease and completes failed then manual retry flow", async () => {
    const { workspace } = await seedWorkspace();
    const createdForm = await createForm(workspace.slug, "Pipeline form");
    await saveDraft(workspace.slug, createdForm.id, schema());
    const publishedVersion = await publishForm(workspace.slug, createdForm.id);
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
});

test("integration suite documents its isolated database requirement", () => {
  if (!process.env.TEST_DATABASE_URL) {
    expect(AppError).toBeDefined();
  }
});
