import "server-only";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { outboxEvents } from "@/db/schema";
import {
  deliveryRequested,
  inngest,
  submissionReceived,
} from "@/inngest/client";

const eventForOutbox = (event: { aggregateId: string; type: string }) => {
  switch (event.type) {
    case "submission.received":
      return submissionReceived.create({ submissionId: event.aggregateId });
    case "delivery.retry_requested":
      return deliveryRequested.create({ deliveryId: event.aggregateId });
    default:
      throw new Error(`Unsupported outbox event type: ${event.type}`);
  }
};

export const dispatchPendingOutbox = async (limit = 25) => {
  const candidates = await db
    .select({
      aggregateId: outboxEvents.aggregateId,
      id: outboxEvents.id,
      type: outboxEvents.type,
    })
    .from(outboxEvents)
    .where(
      and(
        inArray(outboxEvents.status, ["pending", "failed", "processing"]),
        lte(outboxEvents.availableAt, new Date()),
      ),
    )
    .orderBy(asc(outboxEvents.createdAt))
    .limit(limit);

  let sent = 0;
  for (const candidate of candidates) {
    const [claimed] = await db
      .update(outboxEvents)
      .set({
        attempts: sql`${outboxEvents.attempts} + 1`,
        availableAt: new Date(Date.now() + 5 * 60_000),
        status: "processing",
      })
      .where(
        and(
          eq(outboxEvents.id, candidate.id),
          inArray(outboxEvents.status, ["pending", "failed", "processing"]),
        ),
      )
      .returning({ id: outboxEvents.id });
    if (!claimed) continue;

    try {
      await inngest.send(eventForOutbox(candidate));
      await db
        .update(outboxEvents)
        .set({ lastError: null, sentAt: new Date(), status: "sent" })
        .where(eq(outboxEvents.id, candidate.id));
      sent += 1;
    } catch (error) {
      await db
        .update(outboxEvents)
        .set({
          availableAt: new Date(Date.now() + 60_000),
          lastError:
            error instanceof Error
              ? error.message.slice(0, 1_000)
              : "Unknown error",
          status: "failed",
        })
        .where(eq(outboxEvents.id, candidate.id));
    }
  }
  return sent;
};
