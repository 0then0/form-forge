import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.TEST_DATABASE_URL;
const pipelineToken = process.env.E2E_PIPELINE_TOKEN;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL must point to a dedicated disposable PostgreSQL database",
  );
}
if (!pipelineToken) throw new Error("E2E_PIPELINE_TOKEN was not configured");

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const sessionToken = crypto.randomUUID();
const workspaceSlug = `e2e-${crypto.randomUUID()}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await migrate(database, { migrationsFolder });
  await pool.query("truncate table outbox_events, users, workspaces cascade");
  const user = await pool.query<{ id: string }>(
    `insert into users (email, name)
     values ($1, 'Playwright user')
     returning id`,
    [`e2e-${crypto.randomUUID()}@example.com`],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Could not create the e2e user");
  const workspace = await pool.query<{ id: string }>(
    `insert into workspaces (name, slug)
     values ('Playwright workspace', $1)
     returning id`,
    [workspaceSlug],
  );
  const workspaceId = workspace.rows[0]?.id;
  if (!workspaceId) throw new Error("Could not create the e2e workspace");
  await pool.query(
    `insert into memberships (workspace_id, user_id, role)
     values ($1, $2, 'owner')`,
    [workspaceId, userId],
  );
  await pool.query(
    `insert into sessions (session_token, user_id, expires)
     values ($1, $2, now() + interval '1 hour')`,
    [sessionToken, userId],
  );
});

test.afterAll(async () => {
  await pool.query("truncate table outbox_events, users, workspaces cascade");
  await pool.end();
});

test("creates, publishes, submits, fails, retries, and succeeds", async ({
  page,
}) => {
  const baseUrl = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
  );
  await page.context().addCookies([
    {
      domain: baseUrl.hostname,
      expires: Math.floor(Date.now() / 1_000) + 3_600,
      httpOnly: true,
      name: "next-auth.session-token",
      path: "/",
      sameSite: "Lax",
      secure: baseUrl.protocol === "https:",
      value: sessionToken,
    },
  ]);

  const name = `Playwright form ${Date.now()}`;
  const createdResponse = await page.request.post(
    `/api/admin/workspaces/${workspaceSlug}/forms`,
    { data: { name } },
  );
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as {
    data: { id: string; slug: string; updatedAt: string };
  };
  const schema = {
    fields: [
      {
        id: crypto.randomUUID(),
        key: "name",
        label: "Name",
        required: true,
        type: "shortText",
        width: "full",
      },
    ],
    schemaVersion: 1,
    settings: {
      submitLabel: "Submit",
      successMessage: "Your response has been received.",
      successTitle: "Thank you",
    },
    title: name,
  };
  const publishedResponse = await page.request.post(
    `/api/admin/workspaces/${workspaceSlug}/forms/${created.data.id}/publish`,
    {
      data: {
        expectedRevision: created.data.updatedAt,
        schema,
      },
    },
  );
  expect(publishedResponse.status()).toBe(201);
  const published = (await publishedResponse.json()) as {
    data: { id: string };
  };

  const endpointResponse = await page.request.post(
    "/api/internal/e2e/pipeline",
    {
      data: { action: "create-endpoint", formId: created.data.id },
      headers: { "x-form-forge-e2e-token": pipelineToken },
    },
  );
  expect(endpointResponse.status()).toBe(201);

  await page.goto(`/f/${created.data.slug}`);
  await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/forms/${created.data.slug}/submit`),
  );
  await page.getByRole("button", { name: "Submit" }).click();
  const submissionResponse = await submissionResponsePromise;
  expect(submissionResponse.status()).toBe(201);
  await expect(submissionResponse.json()).resolves.toMatchObject({
    data: { submissionId: expect.any(String) },
  });
  await expect(page.getByRole("status")).toBeVisible();

  const processSubmission = await page.request.post(
    "/api/internal/e2e/pipeline",
    {
      data: { action: "process-next", outcome: "failure" },
      headers: { "x-form-forge-e2e-token": pipelineToken },
    },
  );
  expect(processSubmission.status()).toBe(200);
  await expect(processSubmission.json()).resolves.toMatchObject({
    data: { processedType: "form-forge/submission.received", sent: 1 },
  });
  const processFailure = await page.request.post("/api/internal/e2e/pipeline", {
    data: { action: "process-next", outcome: "failure" },
    headers: { "x-form-forge-e2e-token": pipelineToken },
  });
  expect(processFailure.status()).toBe(200);
  const failure = (await processFailure.json()) as {
    data: { deliveryId: string; processedType: string; sent: number };
  };
  expect(failure.data).toMatchObject({
    processedType: "form-forge/delivery.requested",
    sent: 1,
  });
  const deliveryId = failure.data.deliveryId;
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    const retryFailure = await page.request.post("/api/internal/e2e/pipeline", {
      data: {
        action: "process-next",
        advanceDue: true,
        outcome: "failure",
      },
      headers: { "x-form-forge-e2e-token": pipelineToken },
    });
    expect(retryFailure.status()).toBe(200);
    await expect(retryFailure.json()).resolves.toMatchObject({
      data: {
        deliveryId,
        processedType: "form-forge/delivery.requested",
        sent: 1,
      },
    });
  }

  await page.goto(`/app/${workspaceSlug}/deliveries`);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("failed");
  await row.getByRole("link", { name }).click();
  await expect(page.getByText("upstream unavailable").first()).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("pending")).toBeVisible();

  const processSuccess = await page.request.post("/api/internal/e2e/pipeline", {
    data: { action: "process-next", outcome: "success" },
    headers: { "x-form-forge-e2e-token": pipelineToken },
  });
  expect(processSuccess.status()).toBe(200);
  await expect(processSuccess.json()).resolves.toMatchObject({
    data: {
      deliveryId,
      processedType: "form-forge/delivery.requested",
      sent: 1,
    },
  });
  await page.reload();
  await expect(page.getByText("succeeded").first()).toBeVisible();

  const duplicate = await page.request.post(
    `/api/forms/${created.data.slug}/submit`,
    {
      data: { values: { name: "Ada Lovelace" }, versionId: published.data.id },
      headers: { "Idempotency-Key": "playwright-duplicate" },
    },
  );
  expect(duplicate.status()).toBe(201);
  const repeated = await page.request.post(
    `/api/forms/${created.data.slug}/submit`,
    {
      data: { values: { name: "Ada Lovelace" }, versionId: published.data.id },
      headers: { "Idempotency-Key": "playwright-duplicate" },
    },
  );
  expect(repeated.status()).toBe(200);
  await expect(repeated.json()).resolves.toMatchObject({
    data: { duplicate: true },
  });
});
