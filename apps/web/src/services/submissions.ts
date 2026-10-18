import "server-only";

import {
  and,
  desc,
  eq,
  inArray,
  gte,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import {
  auditLogs,
  deletedSubmissionKeys,
  outboxEvents,
  deliveryAttempts,
  forms,
  formVersions,
  submissionEvents,
  submissions,
  webhookDeliveries,
  webhookEndpoints,
} from "@/db/schema";
import { AppError, notFoundError } from "@/lib/errors";
import { submissionStatusMutationSchema } from "@/lib/submission-mutations";
import {
  submissionFilterSchema,
  type SubmissionFilters,
} from "@/lib/submission-filters";
import { z } from "zod";
import { hashDeletedSubmissionKey } from "@/lib/deleted-submission-key";
import { requireUuidParam } from "@/lib/route-params";

type SubmissionCursor = { createdAt: Date; id: string };

const decodeCursor = (cursor: string): SubmissionCursor => {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt = new Date(String(parsed.createdAt));
    if (
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      Number.isNaN(createdAt.getTime())
    ) {
      throw new Error("Invalid cursor shape");
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new AppError("BAD_REQUEST", "Invalid pagination cursor", 400);
  }
};

const encodeCursor = (cursor: SubmissionCursor): string =>
  Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString("base64url");

// Shared by the list and export. Only immutable values enter full-text search;
// jsonb_to_tsvector excludes keys and uses PostgreSQL's built-in simple dictionary.
const submissionConditions = (
  workspaceId: string,
  input: SubmissionFilters,
): SQL[] => {
  const filters = submissionFilterSchema.parse(input);
  const conditions: SQL[] = [eq(forms.workspaceId, workspaceId)];
  if (filters.deliveryStatus)
    conditions.push(eq(submissions.deliveryStatus, filters.deliveryStatus));
  if (filters.processingStatus)
    conditions.push(eq(submissions.processingStatus, filters.processingStatus));
  if (filters.formId) conditions.push(eq(submissions.formId, filters.formId));
  if (filters.from)
    conditions.push(gte(submissions.createdAt, new Date(filters.from)));
  if (filters.until)
    conditions.push(lt(submissions.createdAt, new Date(filters.until)));
  if (filters.q)
    conditions.push(
      sql`jsonb_to_tsvector('simple'::regconfig, ${submissions.normalizedValues}, '["string", "numeric", "boolean"]'::jsonb) @@ websearch_to_tsquery('simple', ${filters.q})`,
    );
  return conditions;
};

export const listSubmissions = async ({
  cursor,
  limit = 25,
  workspaceSlug,
  ...filters
}: SubmissionFilters & {
  cursor?: string | undefined;
  limit?: number | undefined;
  workspaceSlug: string;
}) => {
  const workspace = await requireWorkspace(workspaceSlug);
  limit = z.number().int().min(1).max(100).parse(limit);
  const conditions = submissionConditions(workspace.id, filters);
  if (cursor) {
    const decoded = decodeCursor(cursor);
    const paginationCondition = or(
      lt(submissions.createdAt, decoded.createdAt),
      and(
        eq(submissions.createdAt, decoded.createdAt),
        lt(submissions.id, decoded.id),
      ),
    );
    if (paginationCondition) conditions.push(paginationCondition);
  }

  const rows = await db
    .select({
      createdAt: submissions.createdAt,
      deliveryStatus: submissions.deliveryStatus,
      processingStatus: submissions.processingStatus,
      formId: forms.id,
      formName: forms.name,
      id: submissions.id,
      normalizedValues: submissions.normalizedValues,
      versionNumber: formVersions.versionNumber,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .where(and(...conditions))
    .orderBy(desc(submissions.createdAt), desc(submissions.id))
    .limit(Math.min(limit, 100) + 1);

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      hasNextPage && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
};

export const getSubmissionDetail = async (
  workspaceSlug: string,
  submissionId: string,
) => {
  const validSubmissionId = requireUuidParam(submissionId, "submission ID");
  const workspace = await requireWorkspace(workspaceSlug);
  const [submission] = await db
    .select({
      createdAt: submissions.createdAt,
      deliveryStatus: submissions.deliveryStatus,
      processingStatus: submissions.processingStatus,
      fingerprintHash: submissions.fingerprintHash,
      formId: forms.id,
      formName: forms.name,
      id: submissions.id,
      normalizedValues: submissions.normalizedValues,
      receivedValues: submissions.receivedValues,
      referrer: submissions.referrer,
      schema: formVersions.schema,
      userAgent: submissions.userAgent,
      utm: submissions.utm,
      versionId: formVersions.id,
      versionNumber: formVersions.versionNumber,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .where(
      and(
        eq(submissions.id, validSubmissionId),
        eq(forms.workspaceId, workspace.id),
      ),
    )
    .limit(1);
  if (!submission) throw notFoundError("Submission not found");

  const [eventRows, deliveryRows] = await Promise.all([
    db
      .select()
      .from(submissionEvents)
      .where(eq(submissionEvents.submissionId, validSubmissionId))
      .orderBy(desc(submissionEvents.createdAt))
      .limit(201),
    db
      .select({
        attemptCount: webhookDeliveries.attemptCount,
        endpointArchivedAt: webhookEndpoints.archivedAt,
        endpointEnabled: webhookEndpoints.enabled,
        endpointName: webhookEndpoints.name,
        endpointUrl: webhookEndpoints.url,
        id: webhookDeliveries.id,
        lastError: webhookDeliveries.lastError,
        manualRetryCount: webhookDeliveries.manualRetryCount,
        status: webhookDeliveries.status,
        updatedAt: webhookDeliveries.updatedAt,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookEndpoints,
        eq(webhookEndpoints.id, webhookDeliveries.endpointId),
      )
      .where(eq(webhookDeliveries.submissionId, validSubmissionId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(101),
  ]);
  const eventsTruncated = eventRows.length > 200;
  const deliveriesTruncated = deliveryRows.length > 100;
  const events = eventsTruncated ? eventRows.slice(0, 200) : eventRows;
  const deliveries = deliveriesTruncated
    ? deliveryRows.slice(0, 100)
    : deliveryRows;

  const deliveryIds = deliveries.map((delivery) => delivery.id);
  const attemptRows = deliveryIds.length
    ? await db
        .select()
        .from(deliveryAttempts)
        .where(inArray(deliveryAttempts.deliveryId, deliveryIds))
        .orderBy(desc(deliveryAttempts.startedAt))
        .limit(201)
    : [];
  const attemptsTruncated = attemptRows.length > 200;
  const attempts = attemptsTruncated ? attemptRows.slice(0, 200) : attemptRows;

  return {
    attempts,
    deliveries,
    events,
    historyTruncated:
      attemptsTruncated || deliveriesTruncated || eventsTruncated,
    submission,
  };
};

const escapeCsv = (value: unknown): string => {
  let serialized =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[\t\r]/.test(serialized) || /^\s*[=+\-@]/.test(serialized)) {
    serialized = `'${serialized}`;
  }
  return `"${serialized.replaceAll('"', '""')}"`;
};

const CSV_BATCH_SIZE = 100;
const MAX_EXPORT_ROWS = 10_000;
const MAX_EXPORT_COLUMNS = 500;

export const exportSubmissionsCsv = async (
  workspaceSlug: string,
  filters: SubmissionFilters = {},
) => {
  const workspace = await requireWorkspace(workspaceSlug);
  const conditions = submissionConditions(workspace.id, filters);
  const where = and(...conditions);
  // Freeze membership and display metadata before starting the stream. Values
  // are immutable; later submissions/status changes must not alter this export.
  const selected = await db
    .select({
      id: submissions.id,
      createdAt: submissions.createdAt,
      deliveryStatus: submissions.deliveryStatus,
      processingStatus: submissions.processingStatus,
      formName: forms.name,
      versionNumber: formVersions.versionNumber,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .where(where)
    .orderBy(desc(submissions.createdAt), desc(submissions.id))
    .limit(MAX_EXPORT_ROWS + 1);

  if (selected.length > MAX_EXPORT_ROWS) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This export exceeds 10,000 rows. Filter or archive data before exporting.",
      422,
    );
  }

  const selectedIds = selected.map(({ id }) => id);
  const keyResult = selectedIds.length
    ? await db.execute<{ key: string }>(sql`
    select distinct jsonb_object_keys(${submissions.normalizedValues}) as key
    from ${submissions}
    inner join ${forms} on ${forms.id} = ${submissions.formId}
    where ${inArray(submissions.id, selectedIds)}
    order by key
    limit ${MAX_EXPORT_COLUMNS + 1}
  `)
    : { rows: [] };
  const valueKeys = keyResult.rows.map((row) => row.key);
  if (valueKeys.length > MAX_EXPORT_COLUMNS) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This export contains too many distinct fields.",
      422,
    );
  }
  const headers = [
    "submission_id",
    "form",
    "version",
    "received_at",
    "delivery_status",
    ...valueKeys,
    "processing_status",
  ];
  const encoder = new TextEncoder();
  let offset = 0;

  await db.insert(auditLogs).values({
    action: "submissions.export_requested",
    actorId: workspace.user.id,
    metadata: {
      ...(filters.deliveryStatus
        ? { deliveryStatus: filters.deliveryStatus }
        : {}),
      ...(filters.formId ? { formId: filters.formId } : {}),
      rowCount: selected.length,
    },
    resourceType: "submission",
    workspaceId: workspace.id,
  });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`${headers.map(escapeCsv).join(",")}\r\n`),
      );
    },
    async pull(controller) {
      try {
        const batch = selected.slice(offset, offset + CSV_BATCH_SIZE);
        if (batch.length === 0) {
          controller.close();
          return;
        }
        const rows = await db
          .select({
            id: submissions.id,
            normalizedValues: submissions.normalizedValues,
          })
          .from(submissions)
          .where(
            inArray(
              submissions.id,
              batch.map(({ id }) => id),
            ),
          );
        const valuesById = new Map(
          rows.map((row) => [row.id, row.normalizedValues]),
        );

        const lines = batch.map((row) => {
          const values = valuesById.get(row.id);
          if (!values)
            throw new Error("An exported submission is no longer available");
          return [
            row.id,
            row.formName,
            row.versionNumber,
            row.createdAt.toISOString(),
            row.deliveryStatus,
            ...valueKeys.map((key) => values[key]),
            row.processingStatus,
          ]
            .map(escapeCsv)
            .join(",");
        });
        offset += batch.length;
        controller.enqueue(encoder.encode(`${lines.join("\r\n")}\r\n`));
      } catch (error) {
        controller.error(error);
      }
    },
  });
};

export const deleteSubmission = async (
  workspaceSlug: string,
  submissionId: string,
  confirmation: string,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  const id = requireUuidParam(submissionId, "submission ID");
  if (confirmation !== id)
    throw new AppError(
      "VALIDATION_ERROR",
      "Enter the submission ID to confirm deletion",
      422,
    );
  try {
    return await db.transaction(async (tx) => {
      const [record] = await tx
        .select({ formId: submissions.formId })
        .from(submissions)
        .innerJoin(forms, eq(forms.id, submissions.formId))
        .where(and(eq(submissions.id, id), eq(forms.workspaceId, workspace.id)))
        .limit(1);
      if (!record) throw notFoundError("Submission not found");
      // Admission takes the form lock first. Other workers use different orders;
      // NOWAIT everywhere avoids holding one side while waiting for another.
      await tx
        .select({ id: forms.id })
        .from(forms)
        .where(eq(forms.id, record.formId))
        .for("update", { noWait: true });
      const [submission] = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.id, id))
        .for("update", { noWait: true });
      if (!submission) throw notFoundError("Submission not found");
      const endpointIds = tx
        .select({ id: webhookDeliveries.endpointId })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.submissionId, id));
      await tx
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(inArray(webhookEndpoints.id, endpointIds))
        .for("update", { noWait: true });
      const deliveries = await tx
        .select({ id: webhookDeliveries.id, status: webhookDeliveries.status })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.submissionId, id))
        .for("update", { noWait: true });
      const aggregates = [id, ...deliveries.map((delivery) => delivery.id)];
      const outbox = await tx
        .select({ status: outboxEvents.status })
        .from(outboxEvents)
        .where(inArray(outboxEvents.aggregateId, aggregates))
        .for("update", { noWait: true });
      if (
        deliveries.some((delivery) => delivery.status === "processing") ||
        outbox.some((event) => event.status === "processing")
      )
        throw new AppError(
          "CONFLICT",
          "Background processing is using this response. Wait for it to finish and retry deletion.",
          409,
        );
      await tx
        .insert(deletedSubmissionKeys)
        .values({
          formId: record.formId,
          keyHash: hashDeletedSubmissionKey(
            record.formId,
            submission.idempotencyKey,
          ),
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        })
        .onConflictDoUpdate({
          target: [deletedSubmissionKeys.formId, deletedSubmissionKeys.keyHash],
          set: { expiresAt: new Date(Date.now() + 30 * 86_400_000) },
        });
      await tx
        .delete(outboxEvents)
        .where(inArray(outboxEvents.aggregateId, aggregates));
      // FK cascades remove attempts, deliveries and events in this transaction.
      await tx.delete(submissions).where(eq(submissions.id, id));
      await tx.insert(auditLogs).values({
        action: "submission.deleted",
        actorId: workspace.user.id,
        resourceType: "submission",
        resourceId: id,
        workspaceId: workspace.id,
        metadata: { formId: record.formId },
      });
      return { id };
    });
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "55P03"
    )
      throw new AppError(
        "CONFLICT",
        "Background processing is using this response. Wait for it to finish and retry deletion.",
        409,
      );
    throw error;
  }
};

export const updateSubmissionStatus = async (
  workspaceSlug: string,
  submissionId: string,
  input: unknown,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  const id = requireUuidParam(submissionId, "submission ID");
  const { processingStatus } = submissionStatusMutationSchema.parse(input);
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(submissions)
      .set({ processingStatus })
      .where(
        and(
          eq(submissions.id, id),
          inArray(
            submissions.formId,
            tx
              .select({ id: forms.id })
              .from(forms)
              .where(eq(forms.workspaceId, workspace.id)),
          ),
        ),
      )
      .returning({
        id: submissions.id,
        processingStatus: submissions.processingStatus,
      });
    if (!updated) throw notFoundError("Submission not found");
    await tx.insert(auditLogs).values({
      action: "submission.status_updated",
      actorId: workspace.user.id,
      workspaceId: workspace.id,
      resourceType: "submission",
      resourceId: id,
      metadata: { processingStatus },
    });
    return updated;
  });
};
