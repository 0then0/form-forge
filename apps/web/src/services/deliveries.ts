import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { validateWebhookUrl } from "@/integration/webhooks/url-policy";
import { AppError, notFoundError } from "@/lib/errors";
import { deriveDeliveryStatus } from "@/lib/delivery-status";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export const createDeliveriesForSubmission = async (submissionId: string) =>
  db.transaction(async (tx) => {
    const [submission] = await tx
      .select({ formId: submissions.formId, id: submissions.id })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (!submission) throw notFoundError("Submission not found");

    const endpoints = await tx
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.formId, submission.formId),
          eq(webhookEndpoints.enabled, true),
          sql`${webhookEndpoints.archivedAt} is null`,
        ),
      );

    if (endpoints.length) {
      await tx
        .insert(webhookDeliveries)
        .values(
          endpoints.map((endpoint) => ({
            endpointId: endpoint.id,
            submissionId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: webhookDeliveries.id });
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
    } else {
      await tx.insert(submissionEvents).values({
        data: { deliveryCount: endpoints.length },
        submissionId,
        type: "delivery.enqueued",
      });
    }
    const schedulable = await tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.submissionId, submissionId),
          eq(webhookDeliveries.status, "pending"),
        ),
      );
    return schedulable.map((delivery) => delivery.id);
  });

const readResponseExcerpt = async (response: Response): Promise<string> => {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 65_536) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = 65_536 - size;
    const chunk =
      value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, 65_536);
};

const updateSubmissionDeliveryStatus = async (submissionId: string) => {
  const deliveries = await db
    .select({ status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.submissionId, submissionId));
  const statuses = deliveries.map((delivery) => delivery.status);
  const aggregate = deriveDeliveryStatus(statuses);
  await db
    .update(submissions)
    .set({ deliveryStatus: aggregate })
    .where(eq(submissions.id, submissionId));
};

export const deliverWebhook = async (
  deliveryId: string,
  finalAttempt: boolean,
) => {
  const [record] = await db
    .select({
      attemptCount: webhookDeliveries.attemptCount,
      deliveryStatus: webhookDeliveries.status,
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
  if (record.deliveryStatus === "succeeded") return { skipped: true };

  const [claimed] = await db
    .update(webhookDeliveries)
    .set({
      attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
      status: "processing",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        inArray(webhookDeliveries.status, ["pending", "failed"]),
      ),
    )
    .returning({ attemptCount: webhookDeliveries.attemptCount });
  if (!claimed) return { skipped: true };

  const attemptNumber = claimed.attemptCount;
  const eventId = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const payload = {
    apiVersion: "2026-08-15",
    createdAt: new Date().toISOString(),
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
  const signature = createHmac(
    "sha256",
    decryptWebhookSecret(record.endpointSecret),
  )
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const startedAt = new Date();
  let response: Response | undefined;
  let responseExcerpt = "";
  let caughtError: unknown;

  try {
    const url = await validateWebhookUrl(record.endpointUrl);
    response = await fetch(url, {
      body,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Form-Forge-Webhooks/1.0",
        "X-Form-Forge-Id": eventId,
        "X-Form-Forge-Signature": `v1=${signature}`,
        "X-Form-Forge-Timestamp": timestamp,
      },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    responseExcerpt = await readResponseExcerpt(response);
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
      await tx.insert(deliveryAttempts).values({
        attemptNumber,
        completedAt,
        deliveryId,
        durationMs,
        httpStatus: response?.status,
        responseExcerpt,
        startedAt,
        status: "succeeded",
      });
      await tx
        .update(webhookDeliveries)
        .set({
          lastError: null,
          nextAttemptAt: null,
          status: "succeeded",
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      await tx.insert(submissionEvents).values({
        data: { attemptNumber, deliveryId, httpStatus: response?.status },
        submissionId: record.submissionId,
        type: "delivery.succeeded",
      });
    });
    await updateSubmissionDeliveryStatus(record.submissionId);
    return { skipped: false, success: true };
  }

  const message =
    caughtError instanceof Error
      ? caughtError.message
      : "Unknown delivery error";
  const delay =
    RETRY_DELAYS_MS[Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1)];
  await db.transaction(async (tx) => {
    await tx.insert(deliveryAttempts).values({
      attemptNumber,
      completedAt,
      deliveryId,
      durationMs,
      errorCode:
        caughtError instanceof DOMException &&
        caughtError.name === "TimeoutError"
          ? "TIMEOUT"
          : response
            ? "HTTP_ERROR"
            : "NETWORK_ERROR",
      errorMessage: message.slice(0, 2_000),
      httpStatus: response?.status,
      responseExcerpt,
      startedAt,
      status: "failed",
    });
    await tx
      .update(webhookDeliveries)
      .set({
        lastError: message.slice(0, 2_000),
        nextAttemptAt:
          finalAttempt || delay === undefined
            ? null
            : new Date(Date.now() + delay),
        status: finalAttempt ? "failed" : "pending",
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    await tx.insert(submissionEvents).values({
      data: { attemptNumber, deliveryId, finalAttempt },
      submissionId: record.submissionId,
      type: finalAttempt ? "delivery.failed" : "delivery.attempt_failed",
    });
  });
  await updateSubmissionDeliveryStatus(record.submissionId);
  throw caughtError;
};

export const listWorkspaceDeliveries = async (workspaceSlug: string) => {
  const workspace = await requireWorkspace(workspaceSlug);
  return db
    .select({
      attemptCount: webhookDeliveries.attemptCount,
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
    .where(eq(forms.workspaceId, workspace.id))
    .orderBy(desc(webhookDeliveries.updatedAt))
    .limit(100);
};

export const requestManualRetry = async (
  workspaceSlug: string,
  deliveryId: string,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({
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

    await tx
      .update(webhookDeliveries)
      .set({
        lastError: null,
        manualRetryCount: sql`${webhookDeliveries.manualRetryCount} + 1`,
        nextAttemptAt: null,
        status: "pending",
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    await tx.insert(outboxEvents).values({
      aggregateId: deliveryId,
      payload: { deliveryId },
      type: "delivery.retry_requested",
    });
    await tx.insert(submissionEvents).values({
      data: { deliveryId },
      submissionId: delivery.submissionId,
      type: "delivery.retry_requested",
    });
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
