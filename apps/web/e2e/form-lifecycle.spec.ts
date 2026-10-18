import { defaultFormSchema, type FormSchemaV1 } from "@form-forge/form-schema";
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
  await pool.query(
    "truncate table usage_buckets, outbox_events, users, workspaces cascade",
  );
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
  await pool.query(
    "truncate table usage_buckets, outbox_events, users, workspaces cascade",
  );
  await pool.end();
});

test("keeps guest and signed-in home navigation within the viewport", async ({
  page,
}) => {
  for (const signedIn of [false, true]) {
    if (signedIn) {
      await page.context().addCookies([
        {
          domain: "localhost",
          httpOnly: true,
          name: "next-auth.session-token",
          path: "/",
          sameSite: "Lax",
          secure: false,
          value: sessionToken,
        },
      ]);
    }

    for (const width of [320, 375, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      const navigation = page.getByRole("navigation");
      const workspaceLink = navigation.getByRole("link", {
        name: signedIn ? "Open workspace" : "Sign in",
        exact: true,
      });
      await expect(workspaceLink).toBeVisible();
      await expect(workspaceLink).toHaveAttribute(
        "href",
        signedIn ? "/app" : "/login",
      );
      await expect(
        page.getByRole("link", { name: "Open the workspace", exact: true }),
      ).toHaveAttribute("href", signedIn ? "/app" : "/login");

      const bounds = await workspaceLink.boundingBox();
      if (!bounds) throw new Error("Workspace link must have visible bounds");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  }
});

test("creates, publishes, submits, fails, retries, and succeeds", async ({
  page,
}) => {
  await page.context().addCookies([
    {
      domain: "localhost",
      expires: Math.floor(Date.now() / 1_000) + 3_600,
      httpOnly: true,
      name: "next-auth.session-token",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: sessionToken,
    },
  ]);

  const name = `Playwright form ${Date.now()}`;
  await page.goto(`/app/${workspaceSlug}/forms`);
  await page.getByRole("button", { name: "New form" }).first().click();
  await page.getByLabel("Name").fill(name);
  const createdResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/admin/workspaces/${workspaceSlug}/forms`),
  );
  await page.getByRole("button", { name: "Create form" }).click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.status()).toBe(201);
  // The development server compiles the editor route on its first visit.
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({
    timeout: 15_000,
  });
  const formId = page.url().split("/forms/")[1];
  if (!formId) throw new Error("Editor URL did not contain the form ID");

  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Label").fill("Name");
  await page.getByLabel("Key", { exact: true }).fill("name");
  await page.getByLabel("Required").check();
  page.once("dialog", (dialog) => dialog.accept());
  const publishedResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/forms/${formId}/publish`),
  );
  await page.getByRole("button", { name: "Publish" }).click();
  const publishedResponse = await publishedResponsePromise;
  expect(publishedResponse.status()).toBe(201);
  const published = (await publishedResponse.json()) as {
    data: { id: string };
  };
  const formRow = await pool.query<{ slug: string }>(
    "select slug from forms where id = $1",
    [formId],
  );
  const formSlug = formRow.rows[0]?.slug;
  if (!formSlug) throw new Error("Published form slug was not found");

  // Exercise the JSONB -> parsed draft -> editor boundary, not identical fixtures.
  await page.reload();
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByText("unsaved", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(
    page.getByText(/0 added, 0 changed, 0 removed fields/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();

  const endpointResponse = await page.request.post(
    "/api/internal/e2e/pipeline",
    {
      data: { action: "create-endpoint", formId },
      headers: { "x-form-forge-e2e-token": pipelineToken },
    },
  );
  expect(endpointResponse.status()).toBe(201);

  await page.goto(`/f/${formSlug}`);
  await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/forms/${formSlug}/submit`),
  );
  await page.getByRole("button", { name: "Submit" }).click();
  const submissionResponse = await submissionResponsePromise;
  expect(submissionResponse.status()).toBe(201);
  await expect(submissionResponse.json()).resolves.toMatchObject({
    data: { submissionId: expect.any(String) },
  });
  await expect(page.getByRole("status")).toBeVisible();

  // The new after() path must finish its failed ingestion attempt before the
  // fixture advances persisted scheduling and takes over as the test scheduler.
  await expect
    .poll(
      async () =>
        (
          await pool.query<{ status: string }>(
            "select status from outbox_events where aggregate_id = $1",
            [(await submissionResponse.json()).data.submissionId],
          )
        ).rows[0]?.status,
      { timeout: 20_000 },
    )
    .toBe("failed");
  const processSubmission = await page.request.post(
    "/api/internal/e2e/pipeline",
    {
      data: { action: "process-next", advanceDue: true, outcome: "failure" },
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

  const duplicate = await page.request.post(`/api/forms/${formSlug}/submit`, {
    data: { values: { name: "Ada Lovelace" }, versionId: published.data.id },
    headers: { "Idempotency-Key": "playwright-duplicate" },
  });
  expect(duplicate.status()).toBe(201);
  const repeated = await page.request.post(`/api/forms/${formSlug}/submit`, {
    data: { values: { name: "Ada Lovelace" }, versionId: published.data.id },
    headers: { "Idempotency-Key": "playwright-duplicate" },
  });
  expect(repeated.status()).toBe(200);
  await expect(repeated.json()).resolves.toMatchObject({
    data: { duplicate: true },
  });
});

const signIn = async (page: import("@playwright/test").Page) =>
  page.context().addCookies([
    {
      domain: "localhost",
      httpOnly: true,
      name: "next-auth.session-token",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: sessionToken,
    },
  ]);
const createPublishedFixture = async (
  page: import("@playwright/test").Page,
  fields?: FormSchemaV1["fields"],
) => {
  await signIn(page);
  const created = await page.request.post(
    `/api/admin/workspaces/${workspaceSlug}/forms`,
    { data: { name: `Product ${crypto.randomUUID()}` } },
  );
  expect(created.status()).toBe(201);
  const form = (await created.json()).data as {
    id: string;
    slug: string;
    updatedAt: string;
    name: string;
  };
  const schema: FormSchemaV1 = {
    ...defaultFormSchema(),
    title: form.name,
    fields: fields ?? [
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
  const published = await page.request.post(
    `/api/admin/workspaces/${workspaceSlug}/forms/${form.id}/publish`,
    { data: { expectedRevision: form.updatedAt, schema } },
  );
  expect(published.status()).toBe(201);
  return { form, versionId: (await published.json()).data.id as string };
};

test("manages intake, private metadata, processing, columns, filtered CSV and confirmed deletion", async ({
  page,
}) => {
  test.slow();
  const { form, versionId } = await createPublishedFixture(page);
  const oldTab = await page.context().newPage();
  await oldTab.goto(`/f/${form.slug}`);
  await page.goto(`/app/${workspaceSlug}/forms/${form.id}`);
  await expect(
    page.getByLabel("Collect optional source metadata"),
  ).not.toBeChecked();
  await page.getByLabel("Pause responses").check();
  await page.getByLabel("Closed intake message").fill("Intake paused by owner");
  await page.getByRole("button", { name: "Save intake settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Intake settings saved");
  await oldTab
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Ada private");
  await oldTab.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(oldTab.getByText("Intake paused by owner")).toBeVisible();
  await page.getByLabel("Pause responses").uncheck();
  await page.getByLabel("Maximum accepted responses").fill("1");
  await page.getByRole("button", { name: "Save intake settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Intake settings saved");
  const accepted = oldTab.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/forms/${form.slug}/submit`),
  );
  await oldTab.getByRole("button", { name: "Submit", exact: true }).click();
  const response = await accepted;
  expect(response.status()).toBe(201);
  const submissionId = (await response.json()).data.submissionId as string;
  const submittedRequest = response.request();
  expect(submittedRequest.postDataJSON()).not.toHaveProperty("context");
  expect(
    await oldTab.evaluate(() => localStorage.getItem("form-forge-visitor-id")),
  ).toBeNull();
  const original = await pool.query("select * from submissions where id = $1", [
    submissionId,
  ]);
  expect(original.rows[0]).toMatchObject({
    utm: {},
    fingerprint_hash: null,
    user_agent: null,
    referrer: null,
  });
  const intake = await page.request.get(`/api/forms/${form.slug}`);
  expect((await intake.json()).data.intake.closed).toBe(true);
  const repeated = await page.request.post(`/api/forms/${form.slug}/submit`, {
    headers: {
      "Idempotency-Key":
        submittedRequest.headers()["idempotency-key"] ?? "missing",
    },
    data: { versionId, values: { name: "Ada private" } },
  });
  expect(repeated.status()).toBe(200);
  // Populate the shared query cache, then keep it through client navigation.
  // Full page.goto navigation would conceal stale data after either mutation.
  await page.goto(`/app/${workspaceSlug}/submissions`);
  await page.getByRole("link", { name: form.name, exact: true }).click();
  await page.getByRole("button", { name: "Mark as processed" }).click();
  await expect(page.getByText("Processed", { exact: true })).toBeVisible();
  expect(
    (
      await pool.query("select * from submissions where id = $1", [
        submissionId,
      ])
    ).rows[0],
  ).toEqual({ ...original.rows[0], processing_status: "processed" });
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Submissions", exact: true })
    .click();
  const updatedRow = page.getByRole("row").filter({ hasText: form.name });
  await expect(
    updatedRow.getByRole("cell", { name: "Processed", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter by form").selectOption(form.id);
  await page
    .getByLabel("Filter by processing status")
    .selectOption("processed");
  await page.getByLabel("Search answer words").fill("Ada");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("link", { name: form.name, exact: true }),
  ).toBeVisible();
  await page.getByText("Displayed columns", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Values", exact: true }).uncheck();
  await page
    .getByRole("checkbox", { name: "Answer: name", exact: true })
    .check();
  await expect(
    page.getByRole("columnheader", { name: "Values", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "name", exact: true }),
  ).toBeVisible();
  const href = await page
    .getByRole("link", { name: "Export CSV" })
    .getAttribute("href");
  if (!href) throw new Error("Missing export link");
  const csv = await page.request.get(href);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain(submissionId);
  await page.getByRole("link", { name: form.name, exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await pool.query<{ status: string }>(
            "select status from outbox_events where aggregate_id = $1",
            [submissionId],
          )
        ).rows[0]?.status,
      { timeout: 20_000 },
    )
    .toBe("failed");
  await page
    .getByRole("button", { name: "Delete response", exact: true })
    .click();
  const deleteButton = page.getByRole("button", {
    name: "Permanently delete response",
    exact: true,
  });
  await expect(deleteButton).toBeDisabled();
  await expect(
    page.getByText(/Backup copies and data already received/),
  ).toBeVisible();
  await page
    .getByLabel(`Type submission ID ${submissionId} to confirm`)
    .fill(submissionId);
  await deleteButton.click();
  await expect(page).toHaveURL(`/app/${workspaceSlug}/submissions`);
  await expect(
    page.getByRole("link", { name: form.name, exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Filter by form").selectOption(form.id);
  await page
    .getByLabel("Filter by processing status")
    .selectOption("processed");
  await page.getByLabel("Search answer words").fill("Ada");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No submissions", exact: true }),
  ).toBeVisible();
  expect(
    (
      await pool.query("select accepted_count from forms where id = $1", [
        form.id,
      ])
    ).rows[0]?.accepted_count,
  ).toBe(1);
  const deletedReplay = await page.request.post(
    `/api/forms/${form.slug}/submit`,
    {
      headers: {
        "Idempotency-Key":
          submittedRequest.headers()["idempotency-key"] ?? "missing",
      },
      data: { versionId, values: { name: "Ada private" } },
    },
  );
  expect(deletedReplay.status()).toBe(409);
  await oldTab.close();
});

test("auto-resizes multiple cross-origin embeds and ignores forged messages while preserving plain iframes", async ({
  page,
}) => {
  test.slow();
  const { form } = await createPublishedFixture(page, [
    {
      id: crypto.randomUUID(),
      key: "name",
      label: "Name",
      type: "shortText",
      required: true,
      width: "full",
      validation: { minLength: 3 },
    },
    {
      id: crypto.randomUUID(),
      key: "more",
      label: "More details",
      type: "checkbox",
      required: false,
      width: "full",
    },
    {
      id: crypto.randomUUID(),
      key: "details",
      label: "Details",
      type: "longText",
      required: false,
      width: "full",
      visibility: { fieldKey: "more", operator: "equals", value: true },
    },
  ]);
  // Use an actual loopback document. A fulfilled synthetic document has an
  // unknown address space in Chromium and blocks local-network child frames.
  await page.goto("http://127.0.0.1:3000/");
  await page.evaluate((slug) => {
    const events: Array<{ type: string; keys: string[]; frame: string }> = [];
    (window as unknown as { embedEvents: typeof events }).embedEvents = events;
    for (const type of ["ready", "submitted"])
      window.addEventListener(`formforge:${type}`, (event) => {
        events.push({
          type,
          keys: Object.keys((event as CustomEvent).detail),
          frame: (event.target as HTMLIFrameElement).id,
        });
      });
    for (const id of ["first", "second", "plain"]) {
      const frame = document.createElement("iframe");
      frame.id = id;
      if (id !== "plain") frame.setAttribute("data-form-forge", "");
      frame.src = `http://localhost:3000/f/${slug}?embed=1`;
      frame.width = "600";
      frame.height = "640";
      document.body.append(frame);
    }
  }, form.slug);
  await page.addScriptTag({ url: "/embed.js" });
  const first = page.frameLocator("#first");
  await expect(
    first.getByRole("textbox", { name: "Name", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator("#first").evaluate((node) => node.style.height))
    .not.toBe("");
  await expect
    .poll(() => page.locator("#second").evaluate((node) => node.style.height))
    .not.toBe("");
  const height = () =>
    page
      .locator("#first")
      .evaluate((node) => Number.parseInt(node.style.height, 10));
  const initialHeight = await height();
  const secondHeight = await page
    .locator("#second")
    .evaluate((node) => node.style.height);
  await page.evaluate(() => {
    const element = document.querySelector<HTMLIFrameElement>("#first");
    const second = document.querySelector<HTMLIFrameElement>("#second");
    if (!element || !second) throw new Error("Missing frames");
    const channel = new URL(element.src).searchParams.get("ff_embed_id");
    for (const [origin, source, patch] of [
      ["https://attacker.example", element.contentWindow, {}],
      ["http://localhost:3000", window, {}],
      ["http://localhost:3000", second.contentWindow, {}],
      ["http://localhost:3000", element.contentWindow, { channel: "wrong" }],
      ["http://localhost:3000", element.contentWindow, { height: "9999" }],
    ] as const)
      window.dispatchEvent(
        new MessageEvent("message", {
          origin,
          source,
          data: {
            protocol: "form-forge/embed",
            version: 1,
            channel,
            type: "resize",
            height: 9999,
            ...patch,
          },
        }),
      );
  });
  expect(await height()).toBe(initialHeight);
  await first.getByRole("textbox", { name: "Name", exact: true }).fill("a");
  await first.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    first
      .locator('p[role="alert"]')
      .filter({ hasText: "Must contain at least 3 characters" }),
  ).toBeVisible();
  await expect.poll(height).toBeGreaterThan(initialHeight);
  const errorHeight = await height();
  await first.getByLabel("More details").check();
  await expect(first.getByLabel("Details", { exact: true })).toBeVisible();
  await expect.poll(height).toBeGreaterThan(errorHeight);
  const expandedHeight = await height();
  await first
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Ada embed");
  await first.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(first.getByRole("status")).toBeVisible();
  await expect.poll(height).toBeLessThan(expandedHeight);
  expect(
    await page.locator("#second").evaluate((node) => node.style.height),
  ).toBe(secondHeight);
  await expect(
    page
      .frameLocator("#plain")
      .getByRole("textbox", { name: "Name", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator("#plain").evaluate((node) => node.style.height),
  ).toBe("");
  expect(await page.locator("#plain").getAttribute("height")).toBe("640");
  const events = await page.evaluate(
    () =>
      (
        window as unknown as {
          embedEvents: Array<{ type: string; keys: string[]; frame: string }>;
        }
      ).embedEvents,
  );
  expect(
    events.some((event) => event.type === "ready" && event.frame === "first"),
  ).toBe(true);
  expect(
    events.some((event) => event.type === "ready" && event.frame === "second"),
  ).toBe(true);
  expect(events.filter((event) => event.type === "submitted")).toEqual([
    { type: "submitted", keys: ["iframe"], frame: "first" },
  ]);
  await page.evaluate(() =>
    (
      window as unknown as { FormForgeEmbed: { destroyAll: () => void } }
    ).FormForgeEmbed.destroyAll(),
  );
});
