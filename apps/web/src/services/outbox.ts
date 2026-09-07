import "server-only";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  deliveryAttempts,
  outboxEvents,
  submissionEvents,
  webhookDeliveries,
} from "@/db/schema";
import {
  deliveryRequested,
  inngest,
  submissionReceived,
} from "@/inngest/client";
import {
  DELIVERY_LEASE_MS,
  isFinalDeliveryAttempt,
} from "@/lib/delivery-policy";
import { reconcileSubmissionDeliveryStatus } from "./submission-delivery-status";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const MAX_OUTBOX_ATTEMPTS = 10;
const OUTBOX_RETRY_BASE_MS = 60_000;
const OUTBOX_RETRY_MAX_MS = 60 * 60_000;

// Product events are safe to retry indefinitely: their consumers are
// idempotent and an Inngest outage must not strand a submission or delivery.
// Unknown events keep a finite budget so a poison row cannot be reclaimed
// forever after a deployment mistake.
const isRetryableOutboxType = (type: string): boolean =>
  type === "submission.received" ||
  type === "delivery.requested" ||
  type === "delivery.retry_requested";

const outboxRetryDelay = (attempts: number): number =>
  Math.min(
    OUTBOX_RETRY_BASE_MS * 2 ** Math.min(Math.max(attempts - 1, 0), 16),
    OUTBOX_RETRY_MAX_MS,
  );

const eventForOutbox = (event: {
  aggregateId: string;
  id: string;
  payload: Record<string, unknown>;
  type: string;
}) => {
  switch (event.type) {
    case "submission.received":
      return submissionReceived.create(
        {
          ...(isStringArray(event.payload.endpointIds)
            ? { endpointIds: event.payload.endpointIds }
            : {}),
          submissionId: event.aggregateId,
        },
        { id: event.id },
      );
    case "delivery.requested":
    case "delivery.retry_requested":
      return deliveryRequested.create(
        { deliveryId: event.aggregateId },
        { id: event.id },
      );
    default:
      throw new Error(`Unsupported outbox event type: ${event.type}`);
  }
};

type OutboxEvent = ReturnType<typeof eventForOutbox>;

const getSubmissionIdForOutboxEvent = async (event: {
  aggregateId: string;
  type: string;
}) => {
  if (event.type === "submission.received") return event.aggregateId;
  if (
    event.type !== "delivery.requested" &&
    event.type !== "delivery.retry_requested"
  ) {
    return null;
  }
  const [delivery] = await db
    .select({ submissionId: webhookDeliveries.submissionId })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, event.aggregateId))
    .limit(1);
  return delivery?.submissionId ?? null;
};

export const dispatchPendingOutbox = async (
  limit = 25,
  send: (event: OutboxEvent) => Promise<unknown> = (event) =>
    inngest.send(event),
) => {
  const result = await db.execute<{
    aggregateId: string;
    attempts: number;
    id: string;
    payload: Record<string, unknown>;
    type: string;
  }>(sql`
    with candidates as (
      select id
      from outbox_events
      where status in ('pending', 'failed', 'processing')
        and available_at <= now()
        and (
          type in ('submission.received', 'delivery.requested', 'delivery.retry_requested')
          or attempts < ${MAX_OUTBOX_ATTEMPTS}
        )
      order by available_at, created_at
      for update skip locked
      limit ${Math.max(1, Math.min(limit, 100))}
    )
    update outbox_events as event
    set status = 'processing',
        attempts = event.attempts + 1,
        available_at = now() + interval '5 minutes'
    from candidates
    where event.id = candidates.id
    returning event.id,
              event.aggregate_id as "aggregateId",
              event.payload,
              event.type,
              event.attempts
  `);
  const candidates = result.rows;

  let sent = 0;
  for (const candidate of candidates) {
    try {
      await send(eventForOutbox(candidate));
      const [completed] = await db
        .update(outboxEvents)
        .set({ lastError: null, sentAt: new Date(), status: "sent" })
        .where(
          and(
            eq(outboxEvents.id, candidate.id),
            eq(outboxEvents.status, "processing"),
            eq(outboxEvents.attempts, candidate.attempts),
          ),
        )
        .returning({ id: outboxEvents.id });
      if (completed) sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const retryLimitReached =
        !isRetryableOutboxType(candidate.type) &&
        candidate.attempts >= MAX_OUTBOX_ATTEMPTS;
      const availableAt = new Date(
        Date.now() +
          (retryLimitReached
            ? OUTBOX_RETRY_MAX_MS
            : outboxRetryDelay(candidate.attempts)),
      );
      const reportDispatchFailure =
        isRetryableOutboxType(candidate.type) &&
        candidate.attempts === MAX_OUTBOX_ATTEMPTS;
      const submissionId = reportDispatchFailure
        ? await getSubmissionIdForOutboxEvent(candidate)
        : null;

      await db.transaction(async (tx) => {
        const [failed] = await tx
          .update(outboxEvents)
          .set({
            availableAt,
            lastError:
              `${message}${retryLimitReached ? " (retry limit reached)" : ""}`.slice(
                0,
                1_000,
              ),
            status: "failed",
          })
          .where(
            and(
              eq(outboxEvents.id, candidate.id),
              eq(outboxEvents.status, "processing"),
              eq(outboxEvents.attempts, candidate.attempts),
            ),
          )
          .returning({ id: outboxEvents.id });
        if (failed && submissionId) {
          await tx.insert(submissionEvents).values({
            data: {
              attempts: candidate.attempts,
              eventType: candidate.type,
            },
            submissionId,
            type: "delivery.dispatch_failed",
          });
        }
      });
    }
  }
  return sent;
};

export const enqueueDueDeliveries = async () =>
  db.transaction(async (tx) => {
    const recoveryTime = new Date();
    const recovered = await tx
      .update(webhookDeliveries)
      .set({
        lastError: sql`coalesce(${webhookDeliveries.lastError}, 'Worker lease expired; delivery rescheduled')`,
        leaseToken: null,
        nextAttemptAt: recoveryTime,
        status: "pending",
        updatedAt: recoveryTime,
      })
      .where(
        and(
          eq(webhookDeliveries.status, "processing"),
          or(
            isNull(webhookDeliveries.lockedUntil),
            lte(webhookDeliveries.lockedUntil, recoveryTime),
          ),
        ),
      )
      .returning({
        activeAttemptUrl: webhookDeliveries.activeAttemptUrl,
        attemptCount: webhookDeliveries.attemptCount,
        id: webhookDeliveries.id,
        leaseExpiresAt: webhookDeliveries.lockedUntil,
        manualRetryCount: webhookDeliveries.manualRetryCount,
        submissionId: webhookDeliveries.submissionId,
      });

    if (recovered.length > 0) {
      await tx
        .update(webhookDeliveries)
        .set({ activeAttemptUrl: null, lockedUntil: null })
        .where(
          inArray(
            webhookDeliveries.id,
            recovered.map((delivery) => delivery.id),
          ),
        );
    }

    const finalDeliveryIds = recovered
      .filter((delivery) =>
        isFinalDeliveryAttempt(
          delivery.attemptCount,
          delivery.manualRetryCount,
        ),
      )
      .map((delivery) => delivery.id);
    if (finalDeliveryIds.length > 0) {
      await tx
        .update(webhookDeliveries)
        .set({
          lastError: "Worker lease expired after the final automatic attempt",
          nextAttemptAt: null,
          status: "failed",
        })
        .where(inArray(webhookDeliveries.id, finalDeliveryIds));
    }

    const recordableRecoveries = recovered.filter(
      (delivery) => delivery.attemptCount > 0,
    );
    if (recordableRecoveries.length > 0) {
      await tx
        .insert(deliveryAttempts)
        .values(
          recordableRecoveries.map((delivery) => ({
            attemptNumber: delivery.attemptCount,
            completedAt: recoveryTime,
            deliveryId: delivery.id,
            durationMs: delivery.leaseExpiresAt ? DELIVERY_LEASE_MS : 0,
            errorCode: "WORKER_LEASE_EXPIRED",
            errorMessage:
              "The worker did not record a result before its lease expired",
            requestUrl: delivery.activeAttemptUrl,
            startedAt: delivery.leaseExpiresAt
              ? new Date(delivery.leaseExpiresAt.getTime() - DELIVERY_LEASE_MS)
              : recoveryTime,
            status: "failed" as const,
          })),
        )
        .onConflictDoNothing();
      await tx.insert(submissionEvents).values(
        recordableRecoveries.map((delivery) => ({
          data: {
            attemptNumber: delivery.attemptCount,
            deliveryId: delivery.id,
            finalAttempt: finalDeliveryIds.includes(delivery.id),
          },
          submissionId: delivery.submissionId,
          type: "delivery.lease_expired",
        })),
      );
    }

    const recoveredSubmissionIds = [
      ...new Set(recovered.map((delivery) => delivery.submissionId)),
    ];
    if (recoveredSubmissionIds.length > 0) {
      for (const submissionId of recoveredSubmissionIds.sort()) {
        await reconcileSubmissionDeliveryStatus(tx, submissionId);
      }
    }

    const due = await tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          or(
            isNull(webhookDeliveries.nextAttemptAt),
            lte(webhookDeliveries.nextAttemptAt, new Date()),
          ),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.id))
      .limit(500);

    if (due.length > 0) {
      await tx
        .insert(outboxEvents)
        .values(
          due.map(({ id }) => ({
            aggregateId: id,
            payload: { deliveryId: id },
            type: "delivery.requested",
          })),
        )
        .onConflictDoNothing();
    }
    return due.length;
  });
