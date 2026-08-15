import "server-only";

import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import {
  auditLogs,
  deliveryAttempts,
  forms,
  formVersions,
  submissionEvents,
  submissions,
  webhookDeliveries,
  webhookEndpoints,
  type DeliveryStatus,
} from "@/db/schema";
import { AppError, notFoundError } from "@/lib/errors";

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

export const listSubmissions = async ({
  cursor,
  deliveryStatus,
  formId,
  limit = 25,
  workspaceSlug,
}: {
  cursor?: string | undefined;
  deliveryStatus?: DeliveryStatus | undefined;
  formId?: string | undefined;
  limit?: number | undefined;
  workspaceSlug: string;
}) => {
  const workspace = await requireWorkspace(workspaceSlug);
  const conditions: SQL[] = [eq(forms.workspaceId, workspace.id)];
  if (deliveryStatus)
    conditions.push(eq(submissions.deliveryStatus, deliveryStatus));
  if (formId) conditions.push(eq(submissions.formId, formId));
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
  const workspace = await requireWorkspace(workspaceSlug);
  const [submission] = await db
    .select({
      createdAt: submissions.createdAt,
      deliveryStatus: submissions.deliveryStatus,
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
        eq(submissions.id, submissionId),
        eq(forms.workspaceId, workspace.id),
      ),
    )
    .limit(1);
  if (!submission) throw notFoundError("Submission not found");

  const [events, deliveries] = await Promise.all([
    db
      .select()
      .from(submissionEvents)
      .where(eq(submissionEvents.submissionId, submissionId))
      .orderBy(desc(submissionEvents.createdAt)),
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
      .where(eq(webhookDeliveries.submissionId, submissionId))
      .orderBy(desc(webhookDeliveries.createdAt)),
  ]);

  const deliveryIds = deliveries.map((delivery) => delivery.id);
  const attempts = deliveryIds.length
    ? await db
        .select()
        .from(deliveryAttempts)
        .where(inArray(deliveryAttempts.deliveryId, deliveryIds))
        .orderBy(desc(deliveryAttempts.startedAt))
    : [];

  return { attempts, deliveries, events, submission };
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

export const exportSubmissionsCsv = async (workspaceSlug: string) => {
  const workspace = await requireWorkspace(workspaceSlug);
  const rows = await db
    .select({
      createdAt: submissions.createdAt,
      deliveryStatus: submissions.deliveryStatus,
      formName: forms.name,
      id: submissions.id,
      normalizedValues: submissions.normalizedValues,
      versionNumber: formVersions.versionNumber,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .where(eq(forms.workspaceId, workspace.id))
    .orderBy(desc(submissions.createdAt))
    .limit(10_000);

  const valueKeys = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row.normalizedValues))),
  ).sort();
  const headers = [
    "submission_id",
    "form",
    "version",
    "received_at",
    "delivery_status",
    ...valueKeys,
  ];
  const lines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.formName,
        row.versionNumber,
        row.createdAt.toISOString(),
        row.deliveryStatus,
        ...valueKeys.map((key) => row.normalizedValues[key]),
      ]
        .map(escapeCsv)
        .join(","),
    ),
  ];

  await db.insert(auditLogs).values({
    action: "submissions.exported",
    actorId: workspace.user.id,
    metadata: { rowCount: rows.length },
    resourceType: "submission",
    workspaceId: workspace.id,
  });
  return lines.join("\r\n");
};
