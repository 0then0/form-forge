import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 2_000,
  query_timeout: 3_000,
  max: 1,
});
try {
  const journal = JSON.parse(
    readFileSync(
      new URL("../drizzle/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  );
  const latest = journal.entries.at(-1);
  const hash = createHash("sha256")
    .update(
      readFileSync(new URL(`../drizzle/${latest.tag}.sql`, import.meta.url)),
    )
    .digest("hex");
  const migration = await pool.query(
    "select 1 from drizzle.__drizzle_migrations where hash=$1 and created_at=$2",
    [hash, latest.when],
  );
  if (migration.rowCount !== 1) throw new Error("Migrations not applied");
  const response = await fetch("http://127.0.0.1:3000/login", {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("HTTP unavailable");
} catch {
  console.error("Application not ready (HTTP, database or migration check)");
  process.exitCode = 1;
} finally {
  await pool.end();
}
