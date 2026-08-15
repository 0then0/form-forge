import "server-only";

import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { createHmac } from "node:crypto";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import {
  auditLogs,
  deliveryAttempts,
  forms,
  formVersions,
  outboxEvents,
  submissionEvents,
  submissions,
  webhookDeliveries,
  webhookEndpoints,
} from "@/db/schema";
import { decryptWebhookSecret } from "@/integration/webhooks/crypto";
import { postWebhook } from "@/integration/webhooks/transport";
import {
  DELIVERY_LEASE_MS,
  isFinalDeliveryAttempt,
} from "@/lib/delivery-policy";
import { AppError, notFoundError } from "@/lib/errors";
import { deriveDeliveryStatus } from "@/lib/delivery-status";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

type DeliveryCursor = { id: string; updatedAt: Date };

const decodeDeliveryCursor = (cursor: string): DeliveryCursor => {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { id?: unknown; updatedAt?: unknown };
    const updatedAt = new Date(String(parsed.updatedAt));
    if (
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      Number.isNaN(updatedAt.getTime())
    ) {
      throw new Error("Invalid cursor shape");
    }
    return { id: parsed.id, updatedAt };
  } catch {
    throw new AppError("BAD_REQUEST", "Invalid pagination cursor", 400);
  }
};

const encodeDeliveryCursor = ({ id, updatedAt }: DeliveryCursor): string =>
  Buffer.from(
    JSON.stringify({ id, updatedAt: updatedAt.toISOString() }),
  ).toString("base64url");

export const createDeliveriesForSubmission = async (
  submissionId: string,
  endpointIds?: string[],
) =>
  db.transaction(async (tx) => {
    const [submission] = await tx
      .select({ formId: submissions.formId, id: submissions.id })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!submission) throw notFoundError("Submission not found");

    const endpoints =
      endpointIds?.length === 0
        ? []
        : await tx
            .select({ id: webhookEndpoints.id })
            .from(webhookEndpoints)
            .where(
              endpointIds
                ? and(
                    eq(webhookEndpoints.formId, submission.formId),
                    inArray(webhookEndpoints.id, endpointIds),
                  )
                : and(
                    eq(webhookEndpoints.formId, submission.formId),
                    eq(webhookEndpoints.enabled, true),
                    isNull(webhookEndpoints.archivedAt),
                  ),
            );

    const createdDeliveries = endpoints.length
      ? await tx
          .insert(webhookDeliveries)
          .values(
            endpoints.map((endpoint) => ({
              endpointId: endpoint.id,
              submissionId,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: webhookDeliveries.id })
      : [];

    if (createdDeliveries.length > 0) {
      await tx.insert(outboxEvents).values(
        createdDeliveries.map(({ id }) => ({
          aggregateId: id,
          payload: { deliveryId: id },
          type: "delivery.requested",
        })),
      );
    }

    if (endpoints.length === 0) {
      await tx
        .update(submissions)
        .set({ deliveryStatus: "succeeded" })
        .where(eq(submissions.id, submissionId));
      await tx.insert(submissionEvents).values({
        data: {},
        submissionId,
        type: "delivery.not_configured",
      });
    } else if (createdDeliveries.length > 0) {
      await tx.insert(submissionEvents).values({
        data: { deliveryCount: createdDeliveries.length },
        submissionId,
        type: "delivery.enqueued",
      });
    }
    return createdDeliveries.length;
  });

const updateSubmissionDeliveryStatus = async (
  executor: Pick<typeof db, "select" | "update">,
  submissionId: string,
) => {
  const deliveries = await executor
    .select({ status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.submissionId, submissionId));
  const statuses = deliveries.map((delivery) => delivery.status);
  const aggregate = deriveDeliveryStatus(statuses);
  await executor
    .update(submissions)
    .set({ deliveryStatus: aggregate })
    .where(eq(submissions.id, submissionId));
};

export const deliverWebhook = async (
  deliveryId: string,
  transport: typeof postWebhook = postWebhook,
) => {
  const [record] = await db
    .select({
      attemptCount: webhookDeliveries.attemptCount,
      deliveryStatus: webhookDeliveries.status,
      endpointArchivedAt: webhookEndpoints.archivedAt,
      endpointEnabled: webhookEndpoints.enabled,
      endpointId: webhookEndpoints.id,
      endpointName: webhookEndpoints.name,
      endpointSecret: webhookEndpoints.secretCiphertext,
      endpointUrl: webhookEndpoints.url,
      formId: forms.id,
      formName: forms.name,
      formSlug: forms.slug,
      normalizedValues: submissions.normalizedValues,
      submissionCreatedAt: submissions.createdAt,
      submissionId: submissions.id,
      utm: submissions.utm,
      versionId: formVersions.id,
      versionNumber: formVersions.versionNumber,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookEndpoints.id, webhookDeliveries.endpointId),
    )
    .innerJoin(submissions, eq(submissions.id, webhookDeliveries.submissionId))
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!record) throw notFoundError("Delivery not found");
  if (
    record.deliveryStatus === "succeeded" ||
    record.deliveryStatus === "failed"
  ) {
    return { skipped: true };
  }

  const now = new Date();
  if (!record.endpointEnabled || record.endpointArchivedAt) {
    const terminalized = await db.transaction(async (tx) => {
      const [failed] = await tx
        .update(webhookDeliveries)
        .set({
          activeAttemptUrl: null,
          lastError: record.endpointArchivedAt
            ? "Webhook endpoint was archived"
            : "Webhook endpoint is disabled",
          leaseToken: null,
          lockedUntil: null,
          nextAttemptAt: null,
          status: "failed",
          updatedAt: now,
        })
        .where(
          and(
            eq(webhookDeliveries.id, deliveryId),
            or(
              eq(webhookDeliveries.status, "pending"),
              and(
                eq(webhookDeliveries.status, "processing"),
                or(
                  isNull(webhookDeliveries.lockedUntil),
                  lte(webhookDeliveries.lockedUntil, now),
                ),
              ),
            ),
          ),
        )
        .returning({ id: webhookDeliveries.id });
      if (!failed) return false;
      await tx.insert(submissionEvents).values({
        data: {
          deliveryId,
          endpointId: record.endpointId,
          reason: record.endpointArchivedAt ? "archived" : "disabled",
        },
        submissionId: record.submissionId,
        type: "delivery.endpoint_unavailable",
      });
      await updateSubmissionDeliveryStatus(tx, record.submissionId);
      return true;
    });
    return terminalized
      ? { finalAttempt: true, skipped: false, success: false }
      : { skipped: true };
  }

  const leaseToken = crypto.randomUUID();
  const [claimed] = await db
    .update(webhookDeliveries)
    .set({
      activeAttemptUrl: sql`(
        select ${webhookEndpoints.url}
        from ${webhookEndpoints}
        where ${webhookEndpoints.id} = ${webhookDeliveries.endpointId}
      )`,
      attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
      leaseToken,
      lockedUntil: new Date(now.getTime() + DELIVERY_LEASE_MS),
      nextAttemptAt: null,
      status: "processing",
      updatedAt: now,
    })
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        or(
          and(
            eq(webhookDeliveries.status, "pending"),
            or(
              isNull(webhookDeliveries.nextAttemptAt),
              lte(webhookDeliveries.nextAttemptAt, now),
            ),
          ),
          and(
            eq(webhookDeliveries.status, "processing"),
            or(
              isNull(webhookDeliveries.lockedUntil),
              lte(webhookDeliveries.lockedUntil, now),
            ),
          ),
        ),
        sql`exists (
          select 1
          from ${webhookEndpoints}
          where ${webhookEndpoints.id} = ${webhookDeliveries.endpointId}
            and ${webhookEndpoints.enabled} = true
            and ${webhookEndpoints.archivedAt} is null
        )`,
      ),
    )
    .returning({
      activeAttemptUrl: webhookDeliveries.activeAttemptUrl,
      attemptCount: webhookDeliveries.attemptCount,
      manualRetryCount: webhookDeliveries.manualRetryCount,
    });
  if (!claimed) return { skipped: true };
  if (!claimed.activeAttemptUrl) {
    throw new Error("Claimed delivery is missing its request URL");
  }

  const [currentEndpoint] = await db
    .select({
      archivedAt: webhookEndpoints.archivedAt,
      enabled: webhookEndpoints.enabled,
      secret: webhookEndpoints.secretCiphertext,
      url: webhookEndpoints.url,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookEndpoints.id, webhookDeliveries.endpointId),
    )
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!currentEndpoint) throw notFoundError("Webhook endpoint not found");
  if (!currentEndpoint.enabled || currentEndpoint.archivedAt) {
    await db.transaction(async (tx) => {
      const [failed] = await tx
        .update(webhookDeliveries)
        .set({
          activeAttemptUrl: null,
          lastError: currentEndpoint.archivedAt
            ? "Webhook endpoint was archived"
            : "Webhook endpoint is disabled",
          leaseToken: null,
          lockedUntil: null,
          nextAttemptAt: null,
          status: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(webhookDeliveries.id, deliveryId),
            eq(webhookDeliveries.leaseToken, leaseToken),
          ),
        )
        .returning({ id: webhookDeliveries.id });
      if (!failed) return;
      await tx.insert(submissionEvents).values({
        data: {
          deliveryId,
          endpointId: record.endpointId,
          reason: currentEndpoint.archivedAt ? "archived" : "disabled",
        },
        submissionId: record.submissionId,
        type: "delivery.endpoint_unavailable",
      });
      await updateSubmissionDeliveryStatus(tx, record.submissionId);
    });
    return { finalAttempt: true, skipped: false, success: false };
  }

  const attemptNumber = claimed.attemptCount;
  const eventId = deliveryId;
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const payload = {
    apiVersion: "2026-08-15",
    createdAt: record.submissionCreatedAt.toISOString(),
    data: {
      form: {
        id: record.formId,
        name: record.formName,
        slug: record.formSlug,
      },
      submission: {
        createdAt: record.submissionCreatedAt.toISOString(),
        id: record.submissionId,
        utm: record.utm,
        values: record.normalizedValues,
      },
      version: { id: record.versionId, number: record.versionNumber },
    },
    id: eventId,
    type: "submission.created",
  };
  const body = JSON.stringify(payload);
  const startedAt = new Date();
  let configurationReady = false;
  let httpStatus: number | undefined;
  let responseExcerpt = "";
  let caughtError: unknown;

  try {
    const signature = createHmac(
      "sha256",
      decryptWebhookSecret(currentEndpoint.secret),
    )
      .update(`${timestamp}.${body}`)
      .digest("hex");
    configurationReady = true;
    const response = await transport(claimed.activeAttemptUrl, body, {
      "Content-Type": "application/json",
      "User-Agent": "Form-Forge-Webhooks/1.0",
      "X-Form-Forge-Id": eventId,
      "X-Form-Forge-Signature": `v1=${signature}`,
      "X-Form-Forge-Timestamp": timestamp,
    });
    httpStatus = response.status;
    responseExcerpt = response.responseExcerpt;
    if (!response.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Webhook returned HTTP ${response.status}`,
        response.status,
      );
    }
  } catch (error) {
    caughtError = error;
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  if (!caughtError) {
    await db.transaction(async (tx) => {
      const [completed] = await tx
        .update(webhookDeliveries)
        .set({
          activeAttemptUrl: null,
          lastError: null,
          leaseToken: null,
          lockedUntil: null,
          nextAttemptAt: null,
          status: "succeeded",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(webhookDeliveries.id, deliveryId),
            eq(webhookDeliveries.leaseToken, leaseToken),
          ),
        )
        .returning({ id: webhookDeliveries.id });
      if (!completed) return;
      await tx.insert(deliveryAttempts).values({
        attemptNumber,
        completedAt,
        deliveryId,
        durationMs,
        httpStatus,
        requestUrl: claimed.activeAttemptUrl,
        responseExcerpt,
        startedAt,
        status: "succeeded",
      });
      await tx.insert(submissionEvents).values({
        data: { attemptNumber, deliveryId, httpStatus },
        submissionId: record.submissionId,
        type: "delivery.succeeded",
      });
      if (claimed.manualRetryCount > 0) {
        await tx.insert(submissionEvents).values({
          data: {
            attemptNumber,
            deliveryId,
            manualRetryCount: claimed.manualRetryCount,
          },
          submissionId: record.submissionId,
          type: "delivery.retry_completed",
        });
      }
      await updateSubmissionDeliveryStatus(tx, record.submissionId);
    });
    return { skipped: false, success: true };
  }

  const message =
    caughtError instanceof Error
      ? caughtError.message
      : "Unknown delivery error";
  const delay =
    RETRY_DELAYS_MS[Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1)];
  const finalAttempt = isFinalDeliveryAttempt(
    attemptNumber,
    claimed.manualRetryCount,
  );
  const nextAttemptAt =
    finalAttempt || delay === undefined ? null : new Date(Date.now() + delay);
  await db.transaction(async (tx) => {
    const [completed] = await tx
      .update(webhookDeliveries)
      .set({
        activeAttemptUrl: null,
        lastError: message.slice(0, 2_000),
        leaseToken: null,
        lockedUntil: null,
        nextAttemptAt,
        status: finalAttempt ? "failed" : "pending",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.leaseToken, leaseToken),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    if (!completed) return;
    await tx.insert(deliveryAttempts).values({
      attemptNumber,
      completedAt,
      deliveryId,
      durationMs,
      errorCode: !configurationReady
        ? "CONFIGURATION_ERROR"
        : caughtError instanceof Error &&
            (caughtError.name === "TimeoutError" ||
              caughtError.name === "AbortError")
          ? "TIMEOUT"
          : httpStatus !== undefined
            ? "HTTP_ERROR"
            : "NETWORK_ERROR",
      errorMessage: message.slice(0, 2_000),
      httpStatus,
      requestUrl: claimed.activeAttemptUrl,
      responseExcerpt,
      startedAt,
      status: "failed",
    });
    if (nextAttemptAt) {
      await tx
        .insert(outboxEvents)
        .values({
          aggregateId: deliveryId,
          availableAt: nextAttemptAt,
          payload: { deliveryId },
          type: "delivery.requested",
        })
        .onConflictDoNothing();
    }
    await tx.insert(submissionEvents).values({
      data: { attemptNumber, deliveryId, finalAttempt },
      submissionId: record.submissionId,
      type: finalAttempt ? "delivery.failed" : "delivery.attempt_failed",
    });
    await updateSubmissionDeliveryStatus(tx, record.submissionId);
  });
  return { finalAttempt, skipped: false, success: false };
};

export const listWorkspaceDeliveries = async ({
  cursor,
  formId,
  limit = 25,
  status,
  workspaceSlug,
}: {
  cursor?: string | undefined;
  formId?: string | undefined;
  limit?: number | undefined;
  status?: "pending" | "processing" | "succeeded" | "failed" | undefined;
  workspaceSlug: string;
}) => {
  const workspace = await requireWorkspace(workspaceSlug);
  const conditions: SQL[] = [eq(forms.workspaceId, workspace.id)];
  if (formId) conditions.push(eq(forms.id, formId));
  if (status) conditions.push(eq(webhookDeliveries.status, status));
  if (cursor) {
    const decoded = decodeDeliveryCursor(cursor);
    const paginationCondition = or(
      lt(webhookDeliveries.updatedAt, decoded.updatedAt),
      and(
        eq(webhookDeliveries.updatedAt, decoded.updatedAt),
        lt(webhookDeliveries.id, decoded.id),
      ),
    );
    if (paginationCondition) conditions.push(paginationCondition);
  }

  const rows = await db
    .select({
      attemptCount: webhookDeliveries.attemptCount,
      endpointArchivedAt: webhookEndpoints.archivedAt,
      endpointEnabled: webhookEndpoints.enabled,
      endpointName: webhookEndpoints.name,
      formName: forms.name,
      id: webhookDeliveries.id,
      lastError: webhookDeliveries.lastError,
      status: webhookDeliveries.status,
      submissionId: submissions.id,
      updatedAt: webhookDeliveries.updatedAt,
    })
    .from(webhookDeliveries)
    .innerJoin(submissions, eq(submissions.id, webhookDeliveries.submissionId))
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(
      webhookEndpoints,
      eq(webhookEndpoints.id, webhookDeliveries.endpointId),
    )
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.updatedAt), desc(webhookDeliveries.id))
    .limit(Math.min(limit, 100) + 1);

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      hasNextPage && last
        ? encodeDeliveryCursor({ id: last.id, updatedAt: last.updatedAt })
        : null,
  };
};

export const requestManualRetry = async (
  workspaceSlug: string,
  deliveryId: string,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({
        endpointArchivedAt: webhookEndpoints.archivedAt,
        endpointEnabled: webhookEndpoints.enabled,
        formId: forms.id,
        id: webhookDeliveries.id,
        status: webhookDeliveries.status,
        submissionId: submissions.id,
      })
      .from(webhookDeliveries)
      .innerJoin(
        submissions,
        eq(submissions.id, webhookDeliveries.submissionId),
      )
      .innerJoin(forms, eq(forms.id, submissions.formId))
      .innerJoin(
        webhookEndpoints,
        eq(webhookEndpoints.id, webhookDeliveries.endpointId),
      )
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(forms.workspaceId, workspace.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!delivery) throw notFoundError("Delivery not found");
    if (delivery.status !== "failed") {
      throw new AppError(
        "CONFLICT",
        "Only a failed delivery can be retried",
        409,
      );
    }
    if (!delivery.endpointEnabled || delivery.endpointArchivedAt) {
      throw new AppError(
        "CONFLICT",
        "Enable the webhook endpoint before retrying this delivery",
        409,
      );
    }

    const retryRequestedAt = new Date();
    const [rescheduledEvent] = await tx
      .update(outboxEvents)
      .set({
        availableAt: retryRequestedAt,
        lastError: null,
        sentAt: null,
        status: "pending",
      })
      .where(
        and(
          eq(outboxEvents.aggregateId, deliveryId),
          eq(outboxEvents.type, "delivery.requested"),
          or(
            eq(outboxEvents.status, "pending"),
            eq(outboxEvents.status, "processing"),
            eq(outboxEvents.status, "failed"),
          ),
        ),
      )
      .returning({ id: outboxEvents.id });
    if (!rescheduledEvent) {
      await tx.insert(outboxEvents).values({
        aggregateId: deliveryId,
        availableAt: retryRequestedAt,
        payload: { deliveryId },
        type: "delivery.requested",
      });
    }
    await tx
      .update(webhookDeliveries)
      .set({
        lastError: null,
        leaseToken: null,
        lockedUntil: null,
        manualRetryCount: sql`${webhookDeliveries.manualRetryCount} + 1`,
        nextAttemptAt: retryRequestedAt,
        status: "pending",
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    await tx.insert(submissionEvents).values({
      data: { deliveryId },
      submissionId: delivery.submissionId,
      type: "delivery.retry_requested",
    });
    await updateSubmissionDeliveryStatus(tx, delivery.submissionId);
    await tx.insert(auditLogs).values({
      action: "delivery.retry_requested",
      actorId: workspace.user.id,
      metadata: { submissionId: delivery.submissionId },
      resourceId: deliveryId,
      resourceType: "webhook_delivery",
      workspaceId: workspace.id,
    });
    return { id: deliveryId, status: "pending" as const };
  });
};
