// @vitest-environment node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { expect, test } from "vitest";

const exec = promisify(execFile);

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "CLI upgrades 0005, rolls back a failed 0006 and retries without duplicating history",
  async () => {
    // TEST_DATABASE_URL must point to the disposable test server, never an installation.
    const admin = new pg.Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const database = `form_forge_migrations_${randomUUID().replaceAll("-", "")}`;
    const folder = await mkdtemp(join(tmpdir(), "form-forge-migrations-"));
    let client;
    let created = false;
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${database}"`);
      created = true;
      const url = new URL(process.env.TEST_DATABASE_URL);
      url.pathname = `/${database}`;
      client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      const journal = JSON.parse(
        await readFile(
          new URL("../drizzle/meta/_journal.json", import.meta.url),
          "utf8",
        ),
      );
      journal.entries = journal.entries.filter((entry) => entry.idx < 6);
      await mkdir(join(folder, "meta"));
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries) {
        await copyFile(
          new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
          join(folder, `${entry.tag}.sql`),
        );
      }
      await migrate(drizzle(client), { migrationsFolder: folder });
      await client.query(
        "INSERT INTO workspaces (name, slug) VALUES ('Historical workspace', 'historical')",
      );
      const before = (
        await client.query(
          "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
        )
      ).rows;
      expect(before).toHaveLength(6);
      const run = (timeout = "300000") =>
        exec(
          process.execPath,
          [new URL("./migrate.mjs", import.meta.url).pathname],
          {
            env: {
              ...process.env,
              DATABASE_URL: url.toString(),
              MIGRATION_STATEMENT_TIMEOUT_MS: timeout,
            },
            timeout: 20_000,
          },
        );

      await client.query("BEGIN");
      await client.query("LOCK TABLE forms IN ACCESS EXCLUSIVE MODE");
      try {
        await expect(run("200")).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining("57014"),
        });
      } finally {
        await client.query("ROLLBACK");
      }
      expect(
        (
          await client.query(
            "SELECT to_regclass('public.deleted_submission_keys') AS table_name",
          )
        ).rows[0].table_name,
      ).toBeNull();
      expect(
        (
          await client.query(
            "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
          )
        ).rows,
      ).toEqual(before);

      expect((await run()).stdout).toContain("Migrations completed");
      expect((await run()).stdout).toContain("Migrations completed");
      const after = (
        await client.query(
          "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
        )
      ).rows;
      expect(after).toHaveLength(7);
      expect(after.slice(0, 6)).toEqual(before);
      expect((await client.query("SELECT name FROM workspaces")).rows).toEqual([
        { name: "Historical workspace" },
      ]);
      expect(
        (
          await client.query(
            "SELECT column_default FROM information_schema.columns WHERE table_name = 'forms' AND column_name = 'collect_metadata'",
          )
        ).rows,
      ).toEqual([{ column_default: "false" }]);
    } finally {
      await client?.end();
      try {
        if (created)
          await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      } finally {
        await admin.end();
        await rm(folder, { recursive: true, force: true });
      }
    }
  },
  30_000,
);
