import "server-only";
import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// Due times, not creation times: a scheduled retry is not a stalled delivery.
export const inspectPipelineHealth = async () => {
  const result = await db.execute<{ outbox: number; deliveries: number }>(sql`
    select
      (select count(*)::int from outbox_events
       where status in ('pending', 'failed', 'processing')
         and available_at < now() - interval '15 minutes') as outbox,
      (select count(*)::int from webhook_deliveries
       where status in ('pending', 'processing')
         and coalesce(locked_until, next_attempt_at, created_at)
           < now() - interval '15 minutes') as deliveries
  `);
  const health = result.rows[0];
  if (!health) throw new Error("Pipeline health query returned no row");
  if (health.outbox > 0 || health.deliveries > 0) {
    const message =
      "Form Forge pipeline has tasks overdue by more than 15 minutes";
    console.warn(message, health);
    Sentry.captureMessage(message, { level: "warning", extra: health });
  }
  return health;
};
