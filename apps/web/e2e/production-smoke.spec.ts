import { expect, test } from "@playwright/test";
import { defaultFormSchema } from "@form-forge/form-schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("A disposable TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl });
const slug = `smoke-${crypto.randomUUID()}`;
const versionId = crypto.randomUUID();
const formId = crypto.randomUUID();

test.beforeAll(async () => {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  await pool.query(
    "truncate table usage_buckets, outbox_events, users, workspaces cascade",
  );
  const user = await pool.query<{ id: string }>(
    "insert into users (email) values ($1) returning id",
    [`${slug}@example.org`],
  );
  const workspace = await pool.query<{ id: string }>(
    "insert into workspaces (name, slug) values ('Smoke', $1) returning id",
    [slug],
  );
  const schema = {
    ...defaultFormSchema(),
    title: "Production smoke",
    fields: [
      {
        id: crypto.randomUUID(),
        key: "name",
        label: "Name",
        type: "shortText",
        required: true,
        width: "full",
      },
    ],
  };
  await pool.query(
    "insert into forms (id, workspace_id, created_by, name, slug, status, draft_schema) values ($1,$2,$3,'Smoke',$4,'published',$5)",
    [formId, workspace.rows[0]?.id, user.rows[0]?.id, slug, schema],
  );
  await pool.query(
    "insert into form_versions (id, form_id, version_number, schema, schema_hash, published_by) values ($1,$2,1,$3,'smoke',$4)",
    [versionId, formId, schema, user.rows[0]?.id],
  );
  await pool.query("update forms set published_version_id=$1 where id=$2", [
    versionId,
    formId,
  ]);
});

test.afterAll(async () => {
  await pool.query(
    "truncate table usage_buckets, outbox_events, users, workspaces cascade",
  );
  await pool.end();
});

test("serves the built application, persists submissions, and disables test controls", async ({
  page,
  request,
}) => {
  await page.goto(`/f/${slug}`);
  await expect(
    page.getByRole("heading", { name: "Production smoke" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  expect(
    (
      await request.post("/api/internal/e2e/pipeline", {
        data: { action: "process-next", outcome: "success" },
      })
    ).status(),
  ).toBe(404);

  const submit = () =>
    request.post(`/api/forms/${slug}/submit`, {
      headers: {
        "Idempotency-Key": "smoke-submit",
        "X-Form-Forge-Client-IP": "198.51.100.20",
      },
      data: { versionId, values: { name: "Production response" } },
    });
  expect((await submit()).status()).toBe(201);
  expect((await submit()).status()).toBe(200);
  const persisted = await pool.query<{ submissions: number; events: number }>(
    "select (select count(*)::int from submissions where form_id=$1) as submissions, (select count(*)::int from outbox_events where type='submission.received') as events",
    [formId],
  );
  expect(persisted.rows[0]).toEqual({ submissions: 1, events: 1 });

  const invalidHeaders = {
    "Idempotency-Key": "invalid-smoke-submit",
    "X-Form-Forge-Client-IP": "198.51.100.21",
  };
  expect(
    (
      await request.post(`/api/forms/${slug}/submit`, {
        headers: invalidHeaders,
        data: "invalid JSON",
      })
    ).status(),
  ).toBe(400);
  // The disposable database contains only this scenario's request buckets.
  // Keep the burst in one window even if it crosses a real UTC minute.
  await pool.query(
    "update usage_buckets set count=0, expires_at=now() + interval '1 hour' where key like 'submit:%'",
  );
  const statuses = await Promise.all(
    Array.from({ length: 64 }, async () =>
      (
        await request.post(`/api/forms/${slug}/submit`, {
          headers: {
            ...invalidHeaders,
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: "invalid JSON",
        })
      ).status(),
    ),
  );
  expect(statuses.filter((status) => status === 400)).toHaveLength(60);
  expect(statuses.filter((status) => status === 429)).toHaveLength(4);
  expect(
    (
      await request.post(`/api/forms/${slug}/submit`, {
        headers: { "Idempotency-Key": "missing-address" },
        data: { versionId, values: { name: "No proxy" } },
      })
    ).status(),
  ).toBe(400);
});
