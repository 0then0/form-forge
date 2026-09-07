import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import {
  auditLogs,
  forms,
  submissionEvents,
  webhookDeliveries,
  webhookEndpoints,
} from "@/db/schema";
import {
  encryptWebhookSecret,
  generateWebhookSecret,
} from "@/integration/webhooks/crypto";
import { validateWebhookUrl } from "@/integration/webhooks/url-policy";
import { notFoundError } from "@/lib/errors";
import { requireUuidParam } from "@/lib/route-params";
import { reconcileSubmissionDeliveryStatus } from "./submission-delivery-status";

const webhookEndpointInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z.url().max(2_000),
  })
  .strict();
const webhookEndpointUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    url: z.url().max(2_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "No changes provided");

const requireFormInWorkspace = async (workspaceId: string, formId: string) => {
  const [active] = await db
    .select({ id: forms.id, status: forms.status })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspaceId)))
    .limit(1);
  if (!active || active.status === "archived")
    throw notFoundError("Form not found");
  return active;
};

const failPendingDeliveries = async (
  tx: Pick<typeof db, "execute" | "insert" | "select" | "update">,
  endpointId: string,
  reason: "archived" | "disabled",
) => {
  const failed = await tx
    .update(webhookDeliveries)
    .set({
      activeAttemptUrl: null,
      lastError:
        reason === "archived"
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
        eq(webhookDeliveries.endpointId, endpointId),
        eq(webhookDeliveries.status, "pending"),
      ),
    )
    .returning({
      id: webhookDeliveries.id,
      submissionId: webhookDeliveries.submissionId,
    });
  if (failed.length === 0) return;

  await tx.insert(submissionEvents).values(
    failed.map((delivery) => ({
      data: { deliveryId: delivery.id, endpointId, reason },
      submissionId: delivery.submissionId,
      type: "delivery.endpoint_unavailable",
    })),
  );
  const submissionIds = [
    ...new Set(failed.map((delivery) => delivery.submissionId)),
  ];
  for (const submissionId of submissionIds.sort()) {
    await reconcileSubmissionDeliveryStatus(tx, submissionId);
  }
};

export const listWebhookEndpoints = async (
  workspaceSlug: string,
  formId: string,
) => {
  const validFormId = requireUuidParam(formId, "form ID");
  const workspace = await requireWorkspace(workspaceSlug);
  await requireFormInWorkspace(workspace.id, validFormId);
  return db
    .select({
      createdAt: webhookEndpoints.createdAt,
      enabled: webhookEndpoints.enabled,
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      url: webhookEndpoints.url,
    })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.formId, validFormId),
        isNull(webhookEndpoints.archivedAt),
      ),
    )
    .orderBy(desc(webhookEndpoints.createdAt));
};

export const createWebhookEndpoint = async (
  workspaceSlug: string,
  formId: string,
  input: unknown,
) => {
  const validFormId = requireUuidParam(formId, "form ID");
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  await requireFormInWorkspace(workspace.id, validFormId);
  const parsed = webhookEndpointInputSchema.parse(input);
  const url = await validateWebhookUrl(parsed.url);
  const secret = generateWebhookSecret();

  const endpoint = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(webhookEndpoints)
      .values({
        formId: validFormId,
        name: parsed.name,
        secretCiphertext: encryptWebhookSecret(secret),
        url,
      })
      .returning({
        enabled: webhookEndpoints.enabled,
        id: webhookEndpoints.id,
        name: webhookEndpoints.name,
        url: webhookEndpoints.url,
      });
    if (!created) throw new Error("Webhook endpoint creation returned no row");

    await tx.insert(auditLogs).values({
      action: "webhook_endpoint.created",
      actorId: workspace.user.id,
      metadata: { name: created.name, url: created.url },
      resourceId: created.id,
      resourceType: "webhook_endpoint",
      workspaceId: workspace.id,
    });
    return created;
  });

  return { ...endpoint, secret };
};

export const updateWebhookEndpoint = async (
  workspaceSlug: string,
  formId: string,
  endpointId: string,
  input: unknown,
) => {
  const validFormId = requireUuidParam(formId, "form ID");
  const validEndpointId = requireUuidParam(endpointId, "webhook endpoint ID");
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  await requireFormInWorkspace(workspace.id, validFormId);
  const parsed = webhookEndpointUpdateSchema.parse(input);
  const url = parsed.url ? await validateWebhookUrl(parsed.url) : undefined;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(webhookEndpoints)
      .set({
        ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(url === undefined ? {} : { url }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookEndpoints.id, validEndpointId),
          eq(webhookEndpoints.formId, validFormId),
          isNull(webhookEndpoints.archivedAt),
        ),
      )
      .returning({
        enabled: webhookEndpoints.enabled,
        id: webhookEndpoints.id,
        name: webhookEndpoints.name,
        url: webhookEndpoints.url,
      });
    if (!updated) throw notFoundError("Webhook endpoint not found");
    if (parsed.enabled === false) {
      await failPendingDeliveries(tx, validEndpointId, "disabled");
    }
    await tx.insert(auditLogs).values({
      action: "webhook_endpoint.updated",
      actorId: workspace.user.id,
      metadata: parsed,
      resourceId: validEndpointId,
      resourceType: "webhook_endpoint",
      workspaceId: workspace.id,
    });
    return updated;
  });
};

export const archiveWebhookEndpoint = async (
  workspaceSlug: string,
  formId: string,
  endpointId: string,
) => {
  const validFormId = requireUuidParam(formId, "form ID");
  const validEndpointId = requireUuidParam(endpointId, "webhook endpoint ID");
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  await requireFormInWorkspace(workspace.id, validFormId);
  return db.transaction(async (tx) => {
    const [archived] = await tx
      .update(webhookEndpoints)
      .set({ archivedAt: new Date(), enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(webhookEndpoints.id, validEndpointId),
          eq(webhookEndpoints.formId, validFormId),
          isNull(webhookEndpoints.archivedAt),
        ),
      )
      .returning({ id: webhookEndpoints.id });
    if (!archived) throw notFoundError("Webhook endpoint not found");
    await failPendingDeliveries(tx, validEndpointId, "archived");
    await tx.insert(auditLogs).values({
      action: "webhook_endpoint.archived",
      actorId: workspace.user.id,
      metadata: {},
      resourceId: validEndpointId,
      resourceType: "webhook_endpoint",
      workspaceId: workspace.id,
    });
    return archived;
  });
};

export const rotateWebhookEndpointSecret = async (
  workspaceSlug: string,
  formId: string,
  endpointId: string,
) => {
  const validFormId = requireUuidParam(formId, "form ID");
  const validEndpointId = requireUuidParam(endpointId, "webhook endpoint ID");
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  await requireFormInWorkspace(workspace.id, validFormId);
  const secret = generateWebhookSecret();
  return db.transaction(async (tx) => {
    const [rotated] = await tx
      .update(webhookEndpoints)
      .set({
        secretCiphertext: encryptWebhookSecret(secret),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookEndpoints.id, validEndpointId),
          eq(webhookEndpoints.formId, validFormId),
          isNull(webhookEndpoints.archivedAt),
        ),
      )
      .returning({ id: webhookEndpoints.id });
    if (!rotated) throw notFoundError("Webhook endpoint not found");
    await tx.insert(auditLogs).values({
      action: "webhook_endpoint.secret_rotated",
      actorId: workspace.user.id,
      metadata: {},
      resourceId: validEndpointId,
      resourceType: "webhook_endpoint",
      workspaceId: workspace.id,
    });
    return { ...rotated, secret };
  });
};
