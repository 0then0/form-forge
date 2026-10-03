import "server-only";

import { sql } from "drizzle-orm";
import { createHmac } from "node:crypto";

import { db } from "@/db/client";
import { env } from "@/env";
import { AppError } from "@/lib/errors";
import { MAX_SUBMIT_REQUESTS_PER_MINUTE } from "@/lib/usage-policy";

// One row per subject: fixed UTC windows, shared by every application instance.
// Daily reservations are made inside the submission transaction and roll back
// with it. Request attempts are committed before reading an untrusted body.
export const consumeUsage = async (
  executor: Pick<typeof db, "execute">,
  key: string,
  limit: number,
  windowSeconds: number,
  amount = 1,
) => {
  if (amount === 0) return;
  const result = await executor.execute<{
    count: number;
    retryAfter: number;
  }>(sql`
    insert into usage_buckets (key, count, expires_at)
    values (${key}, ${amount},
      to_timestamp((floor(extract(epoch from now()) / ${windowSeconds}) + 1) * ${windowSeconds}))
    on conflict (key) do update set
      count = case when usage_buckets.expires_at <= now() then excluded.count
        else least(usage_buckets.count + excluded.count, ${limit + 1}) end,
      expires_at = case when usage_buckets.expires_at <= now() then excluded.expires_at
        else usage_buckets.expires_at end
    returning count, greatest(1, ceil(extract(epoch from expires_at - now())))::int as "retryAfter"
  `);
  const bucket = result.rows[0];
  if (!bucket) throw new Error("Usage reservation returned no row");
  if (bucket.count > limit) {
    throw new AppError(
      "RATE_LIMITED",
      "Usage limit reached. Please try again later.",
      429,
      undefined,
      bucket.retryAfter,
    );
  }
};

export const limitSubmitRequest = async (address?: string) => {
  if (!address && process.env.NODE_ENV === "production") {
    throw new AppError(
      "BAD_REQUEST",
      "A trusted client address is required",
      400,
    );
  }
  const subject = createHmac("sha256", env.FINGERPRINT_SECRET)
    .update(address ?? "local-development")
    .digest("hex");
  await consumeUsage(
    db,
    `submit:${subject}`,
    MAX_SUBMIT_REQUESTS_PER_MINUTE,
    60,
  );
};

export const removeExpiredUsage = async () => {
  await db.execute(sql`delete from usage_buckets where expires_at <= now()`);
};
