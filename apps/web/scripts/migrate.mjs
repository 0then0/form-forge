import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations() {
  let client;
  let connectionError;
  let failed = false;
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error(
        "DATABASE_URL is required; Next.js env files are not loaded.",
      );
      return 1;
    }
    const timeout = Number(
      process.env.MIGRATION_STATEMENT_TIMEOUT_MS ?? 300_000,
    );
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2_147_473_647
    ) {
      console.error(
        "MIGRATION_STATEMENT_TIMEOUT_MS must be a positive integer below 2147473648.",
      );
      return 1;
    }
    client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 15_000,
      statement_timeout: timeout,
      query_timeout: timeout + 10_000,
      lock_timeout: 15_000,
      keepAlive: true,
      application_name: "form-forge-migrate",
    });
    // Idle transport failures are events, not rejected query promises.
    client.on("error", (error) => {
      connectionError ??= error;
    });
    console.log("Connecting to PostgreSQL for migrations...");
    await client.connect();
    console.log("Applying committed Drizzle migrations...");
    await migrate(drizzle(client), { migrationsFolder });
    if (connectionError) throw connectionError;
  } catch (error) {
    failed = true;
    // Drizzle errors may contain SQL and parameters. Never print them or URLs.
    let cause = connectionError ?? error;
    while (cause?.cause) cause = cause.cause;
    const code = /^[A-Z0-9_]{2,40}$/.test(cause?.code) ? cause.code : "UNKNOWN";
    console.error(
      `Migration failed (${code}). No automatic retry was attempted.`,
    );
    console.error(
      "Check connectivity and migration history before rerunning; a lost COMMIT acknowledgement can leave the outcome uncertain.",
    );
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        failed = true;
        console.error("Failed to close the migration connection cleanly.");
      }
    }
  }
  if (connectionError) failed = true;
  if (!failed) console.log("Migrations completed; connection closed.");
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runMigrations();
}
