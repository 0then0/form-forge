import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { outboxEvents, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { env } from "@/env";
import { encryptWebhookSecret } from "@/integration/webhooks/crypto";
import {
  createDeliveriesForSubmission,
  deliverWebhook,
} from "@/services/deliveries";
import { dispatchPendingOutbox } from "@/services/outbox";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-endpoint"), formId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("process-next"),
      advanceDue: z.boolean().optional(),
      outcome: z.enum(["failure", "success"]),
    })
    .strict(),
]);

const unavailable = () =>
  NextResponse.json({ error: { message: "Not found" } }, { status: 404 });

export const POST = async (request: Request) => {
  if (
    process.env.NODE_ENV === "production" ||
    !env.TEST_DATABASE_URL ||
    !env.E2E_PIPELINE_TOKEN ||
    request.headers.get("x-form-forge-e2e-token") !== env.E2E_PIPELINE_TOKEN
  ) {
    return unavailable();
  }

  const input = requestSchema.parse(await request.json());
  if (input.action === "create-endpoint") {
    const [endpoint] = await db
      .insert(webhookEndpoints)
      .values({
        formId: input.formId,
        name: "Playwright endpoint",
        secretCiphertext: encryptWebhookSecret("playwright-secret"),
        url: "https://example.com/webhook",
      })
      .returning({ id: webhookEndpoints.id });
    return NextResponse.json({ data: endpoint }, { status: 201 });
  }

  if (input.advanceDue) {
    // Keep this strictly in the past: a JavaScript timestamp can otherwise be
    // marginally ahead of PostgreSQL's `now()` when the outbox query runs.
    const dueAt = new Date(Date.now() - 1_000);
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: dueAt })
      .where(eq(webhookDeliveries.status, "pending"));
    await db
      .update(outboxEvents)
      .set({ availableAt: dueAt, status: "pending" })
      .where(
        and(
          eq(outboxEvents.type, "delivery.requested"),
          inArray(outboxEvents.status, ["pending", "failed"]),
        ),
      );
  }

  let deliveryId: string | undefined;
  let processedType: string | undefined;
  const sent = await dispatchPendingOutbox(1, async (event) => {
    const message = event as {
      data: { deliveryId?: string; submissionId?: string };
      name: string;
    };
    processedType = message.name;
    if (
      message.name === "form-forge/submission.received" &&
      message.data.submissionId
    ) {
      await createDeliveriesForSubmission(message.data.submissionId);
    } else if (
      message.name === "form-forge/delivery.requested" &&
      message.data.deliveryId
    ) {
      deliveryId = message.data.deliveryId;
    }
  });

  if (deliveryId) {
    await deliverWebhook(deliveryId, async () =>
      input.outcome === "success"
        ? { ok: true, responseExcerpt: "accepted", status: 204 }
        : {
            ok: false,
            responseExcerpt: "upstream unavailable",
            status: 503,
          },
    );
  }

  return NextResponse.json({ data: { deliveryId, processedType, sent } });
};
