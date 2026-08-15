import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import { auditLogs, forms, webhookEndpoints } from "@/db/schema";
import {
  encryptWebhookSecret,
  generateWebhookSecret,
} from "@/integration/webhooks/crypto";
import { validateWebhookUrl } from "@/integration/webhooks/url-policy";
import { notFoundError } from "@/lib/errors";

const webhookEndpointInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z.url().max(2_000),
  })
  .strict();

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

export const listWebhookEndpoints = async (
  workspaceSlug: string,
  formId: string,
) => {
  const workspace = await requireWorkspace(workspaceSlug);
  await requireFormInWorkspace(workspace.id, formId);
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
        eq(webhookEndpoints.formId, formId),
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
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  await requireFormInWorkspace(workspace.id, formId);
  const parsed = webhookEndpointInputSchema.parse(input);
  const url = await validateWebhookUrl(parsed.url);
  const secret = generateWebhookSecret();

  const endpoint = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(webhookEndpoints)
      .values({
        formId,
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
