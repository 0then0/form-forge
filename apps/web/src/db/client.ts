import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/env";
import { assertProductionConfig } from "@/lib/production-config";
import * as schema from "./schema";

// Netlify functions do not execute next start or the standalone startup wrapper.
if (process.env.NODE_ENV === "production" && process.env.SITE_ID) {
  assertProductionConfig(process.env);
}

const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    allowExitOnIdle: process.env.NODE_ENV === "test",
    connectionTimeoutMillis: 5_000,
    connectionString:
      process.env.NODE_ENV === "test" && env.TEST_DATABASE_URL
        ? env.TEST_DATABASE_URL
        : env.DATABASE_URL,
    max: process.env.NODE_ENV === "production" ? 10 : 5,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
