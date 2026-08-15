import "server-only";

import { eq, sql } from "drizzle-orm";

import type { db } from "@/db/client";
import { submissions, webhookDeliveries } from "@/db/schema";
import { deriveDeliveryStatus } from "@/lib/delivery-status";

type Executor = Pick<typeof db, "execute" | "select" | "update">;

export const reconcileSubmissionDeliveryStatus = async (
  executor: Executor,
  submissionId: string,
) => {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${submissionId}, 1))`,
  );
  const deliveries = await executor
    .select({ status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.submissionId, submissionId));
  await executor
    .update(submissions)
    .set({
      deliveryStatus: deriveDeliveryStatus(
        deliveries.map((delivery) => delivery.status),
      ),
    })
    .where(eq(submissions.id, submissionId));
};
