import { defaultFormSchema, type FormSchemaV1 } from "@form-forge/form-schema";
import { chromium, expect, test, type Page } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("A disposable TEST_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl });
const sessionToken = crypto.randomUUID();
const workspaceSlug = `drafts-${crypto.randomUUID()}`;
let userId: string;
let workspaceId: string;

test.beforeAll(async () => {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  userId =
    (
      await pool.query<{ id: string }>(
        "insert into users (email, name) values ($1, 'Draft browser test') returning id",
        [`${workspaceSlug}@example.org`],
      )
    ).rows[0]?.id ?? "";
  workspaceId =
    (
      await pool.query<{ id: string }>(
        "insert into workspaces (name, slug) values ('Draft browser test', $1) returning id",
        [workspaceSlug],
      )
    ).rows[0]?.id ?? "";
  if (!userId || !workspaceId)
    throw new Error("Could not create test identity");
  await pool.query(
    "insert into memberships (workspace_id, user_id, role) values ($1,$2,'owner')",
    [workspaceId, userId],
  );
  await pool.query(
    "insert into sessions (session_token, user_id, expires) values ($1,$2,now() + interval '1 hour')",
    [sessionToken, userId],
  );
});

test.afterAll(async () => {
  await pool.query(
    "delete from outbox_events where aggregate_id in (select s.id from submissions s join forms f on f.id=s.form_id where f.workspace_id=$1)",
    [workspaceId],
  );
  await pool.query(
    "delete from submissions where form_id in (select id from forms where workspace_id=$1)",
    [workspaceId],
  );
  await pool.query("delete from workspaces where id=$1", [workspaceId]);
  await pool.query("delete from users where id=$1", [userId]);
  await pool.query("delete from usage_buckets where key=$1", [
    `submissions:${workspaceId}`,
  ]);
  await pool.end();
});

const signIn = (page: Page) =>
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

const fields = (): FormSchemaV1["fields"] => {
  const common = () => ({
    id: crypto.randomUUID(),
    required: false,
    width: "full" as const,
  });
  return [
    {
      ...common(),
      key: "name",
      label: "Name",
      type: "shortText",
      required: true,
    },
    { ...common(), key: "notes", label: "Notes", type: "longText" },
    { ...common(), key: "email", label: "Email", type: "email" },
    { ...common(), key: "amount", label: "Amount", type: "number" },
    {
      ...common(),
      key: "choice",
      label: "Choice",
      type: "select",
      options: [
        { label: "Option A", value: "a" },
        { label: "Option B", value: "b" },
      ],
    },
    { ...common(), key: "date", label: "Date", type: "date" },
    { ...common(), key: "more", label: "More details", type: "checkbox" },
    {
      ...common(),
      key: "details",
      label: "Details",
      type: "longText",
      visibility: { fieldKey: "more", operator: "equals", value: true },
    },
  ];
};

const createForm = async (page: Page) => {
  await signIn(page);
  const created = await page.request.post(
    `/api/admin/workspaces/${workspaceSlug}/forms`,
    { data: { name: `Saved response ${crypto.randomUUID()}` } },
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
    fields: fields(),
  };
  const publish = await page.request.post(
    `/api/admin/workspaces/${workspaceSlug}/forms/${form.id}/publish`,
    { data: { expectedRevision: form.updatedAt, schema } },
  );
  expect(publish.status()).toBe(201);
  return {
    ...form,
    versionId: (await publish.json()).data.id as string,
    schema,
  };
};

const draftEntries = (page: Page) =>
  page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("form-forge-draft:"),
    ),
  );

const waitSaved = (page: Page) =>
  expect(page.getByText(/Saved on this device at/)).toBeVisible();

test("saves only after opt-in, restores every field type after a real profile restart, and discards without late resurrection", async ({
  page,
}) => {
  test.slow();
  const form = await createForm(page);
  const profile = await mkdtemp(join(tmpdir(), "form-forge-draft-profile-"));
  let context = await chromium.launchPersistentContext(profile, {
    headless: true,
  });
  try {
    let visitor = await context.newPage();
    await visitor.goto(`http://localhost:3000/f/${form.slug}`);
    await visitor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Ада unfinished");
    expect(await draftEntries(visitor)).toEqual([]);
    await visitor.getByLabel("Save answers on this device").check();
    await visitor
      .getByLabel("Notes", { exact: true })
      .fill("Long text\nsecond line");
    await visitor.getByLabel("Email", { exact: true }).fill("ada@unfinished");
    await visitor.getByLabel("Amount", { exact: true }).fill("-");
    await visitor.getByLabel("Choice", { exact: true }).selectOption("b");
    await visitor.getByLabel("Date", { exact: true }).fill("2026-11-12");
    await visitor.getByLabel("More details", { exact: true }).check();
    await visitor
      .getByLabel("Details", { exact: true })
      .fill("Conditional answer");
    await waitSaved(visitor);
    await expect
      .poll(async () => JSON.stringify(await draftEntries(visitor)))
      .toContain("Conditional answer");
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    visitor = await context.newPage();
    await visitor.goto(`http://localhost:3000/f/${form.slug}`);
    await expect(
      visitor.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("");
    await visitor.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      visitor.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Ада unfinished");
    await expect(visitor.getByLabel("Notes", { exact: true })).toHaveValue(
      "Long text\nsecond line",
    );
    await expect(visitor.getByLabel("Email", { exact: true })).toHaveValue(
      "ada@unfinished",
    );
    await expect(visitor.getByLabel("Amount", { exact: true })).toHaveValue(
      "-",
    );
    await expect(visitor.getByLabel("Choice", { exact: true })).toHaveValue(
      "b",
    );
    await expect(visitor.getByLabel("Date", { exact: true })).toHaveValue(
      "2026-11-12",
    );
    await expect(
      visitor.getByLabel("More details", { exact: true }),
    ).toBeChecked();
    await expect(visitor.getByLabel("Details", { exact: true })).toHaveValue(
      "Conditional answer",
    );
    await visitor.getByLabel("More details", { exact: true }).uncheck();
    await expect(visitor.getByLabel("Details", { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => JSON.stringify(await draftEntries(visitor)))
      .not.toContain("Conditional answer");
    await visitor.reload();
    await visitor.getByRole("button", { name: "Resume", exact: true }).click();
    await visitor.getByLabel("More details", { exact: true }).check();
    await expect(visitor.getByLabel("Details", { exact: true })).toHaveValue(
      "",
    );
    await visitor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Pending write");
    await visitor.getByLabel("Save answers on this device").uncheck();
    await expect.poll(() => draftEntries(visitor)).toEqual([]);
    await visitor.reload();
    await expect(
      visitor.getByRole("button", { name: "Resume", exact: true }),
    ).toHaveCount(0);
    await expect(
      visitor.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("");
    await visitor.getByLabel("Save answers on this device").check();
    await visitor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Discard me");
    await expect
      .poll(async () => JSON.stringify(await draftEntries(visitor)))
      .toContain("Discard me");
    await visitor.reload();
    await visitor.getByRole("button", { name: "Discard", exact: true }).click();
    await expect.poll(() => draftEntries(visitor)).toEqual([]);
    await expect(
      visitor.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("");
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("pauses automatic writes on conflicting edits and invalidates saves discarded in another tab", async ({
  page,
}) => {
  const form = await createForm(page);
  await page.goto(`/f/${form.slug}`);
  await page.getByLabel("Save answers on this device").check();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Shared baseline");
  await expect
    .poll(async () => JSON.stringify(await draftEntries(page)))
    .toContain("Shared baseline");
  const other = await page.context().newPage();
  await other.goto(`/f/${form.slug}`);
  await other.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("First tab edit");
  await other
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Second tab edit");
  await expect(other.getByText(/Automatic saving is paused/)).toBeVisible();
  await expect(
    other.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Second tab edit");
  await other
    .getByRole("button", { name: "Use saved answers", exact: true })
    .click();
  await expect(
    other.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("First tab edit");
  await other.getByLabel("Save answers on this device").uncheck();
  await expect(page.getByText(/another tab/)).toBeVisible();
  await expect.poll(() => draftEntries(page)).toEqual([]);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Must stay in memory");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(0);
  await other.close();
});

test("retries a committed submission after losing its response without consuming another place, quota or outbox event", async ({
  page,
}) => {
  test.slow();
  const form = await createForm(page);
  const profile = await mkdtemp(join(tmpdir(), "form-forge-lost-response-"));
  let context = await chromium.launchPersistentContext(profile, {
    headless: true,
  });
  let originalBody = "";
  let originalKey = "";
  try {
    let visitor = await context.newPage();
    await visitor.goto(`http://localhost:3000/f/${form.slug}`);
    await visitor.getByLabel("Save answers on this device").check();
    await visitor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Committed once");
    await visitor.getByLabel("More details", { exact: true }).check();
    await visitor
      .getByLabel("Details", { exact: true })
      .fill("Frozen original");
    await visitor.route(`**/api/forms/${form.slug}/submit`, async (route) => {
      originalBody = route.request().postData() ?? "";
      originalKey = route.request().headers()["idempotency-key"] ?? "";
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      expect(
        (
          await pool.query(
            "select count(*)::int as count from submissions where form_id=$1",
            [form.id],
          )
        ).rows[0]?.count,
      ).toBe(1);
      await route.abort("connectionreset");
    });
    await visitor.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(
      visitor.getByRole("button", {
        name: "Retry original attempt",
        exact: true,
      }),
    ).toBeVisible();
    const before = (
      await pool.query(
        "select (select accepted_count from forms where id=$1) as accepted, (select count(*)::int from submissions where form_id=$1) as submissions, (select count(*)::int from outbox_events where type='submission.received' and aggregate_id in (select id from submissions where form_id=$1)) as events, (select count from usage_buckets where key=$2) as quota",
        [form.id, `submissions:${workspaceId}`],
      )
    ).rows[0];
    expect(before).toMatchObject({ accepted: 1, submissions: 1, events: 1 });
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    visitor = await context.newPage();
    await visitor.goto(`http://localhost:3000/f/${form.slug}`);
    await visitor.getByRole("button", { name: "Resume", exact: true }).click();
    await visitor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Changed after reload");
    let requestCount = 0;
    visitor.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith(`/api/forms/${form.slug}/submit`)
      )
        requestCount += 1;
    });
    await visitor.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(
      visitor.getByText(/before submitting changed answers/),
    ).toBeVisible();
    expect(requestCount).toBe(0);
    const repeatedResponse = visitor.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/forms/${form.slug}/submit`),
    );
    await visitor
      .getByRole("button", { name: "Retry original attempt", exact: true })
      .click();
    const repeated = await repeatedResponse;
    expect(repeated.status()).toBe(200);
    expect(repeated.request().postData()).toBe(originalBody);
    expect(repeated.request().headers()["idempotency-key"]).toBe(originalKey);
    await expect(
      visitor.getByRole("heading", {
        name: form.schema.settings.successTitle,
        exact: true,
      }),
    ).toBeVisible();
    const after = (
      await pool.query(
        "select (select accepted_count from forms where id=$1) as accepted, (select count(*)::int from submissions where form_id=$1) as submissions, (select count(*)::int from outbox_events where type='submission.received' and aggregate_id in (select id from submissions where form_id=$1)) as events, (select count from usage_buckets where key=$2) as quota",
        [form.id, `submissions:${workspaceId}`],
      )
    ).rows[0];
    expect(after).toEqual(before);
    expect(await draftEntries(visitor)).toEqual([]);
    expect(
      await visitor.evaluate(() =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("form-forge-submission:"),
        ),
      ),
    ).toEqual([]);
    await visitor.reload();
    await expect(
      visitor.getByRole("button", { name: "Resume", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("does not import an incompatible published version and honors server intake policy for an open draft", async ({
  page,
}) => {
  const form = await createForm(page);
  await page.goto(`/f/${form.slug}`);
  await page.getByLabel("Save answers on this device").check();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Previous version answer");
  await expect
    .poll(async () => JSON.stringify(await draftEntries(page)))
    .toContain("Previous version answer");
  const revision = (
    await pool.query<{ updated_at: Date }>(
      "select updated_at from forms where id=$1",
      [form.id],
    )
  ).rows[0]?.updated_at;
  const publish = await page.request.post(
    `/api/admin/workspaces/${workspaceSlug}/forms/${form.id}/publish`,
    {
      data: {
        expectedRevision: revision?.toISOString(),
        schema: { ...form.schema, description: "New immutable version" },
      },
    },
  );
  expect(publish.status()).toBe(201);
  await page.reload();
  await expect(
    page.getByText(/Saved answers exist for a different published version/),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /Delete incompatible|Discard incompatible/ })
    .click();
  await expect.poll(() => draftEntries(page)).toEqual([]);
  await page.getByLabel("Save answers on this device").check();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Draft while open");
  await pool.query(
    "update forms set paused=true, closed_message='Paused during draft' where id=$1",
    [form.id],
  );
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Paused during draft")).toBeVisible();
  expect(
    (
      await pool.query(
        "select count(*)::int as count from submissions where form_id=$1",
        [form.id],
      )
    ).rows[0]?.count,
  ).toBe(0);
  await page.reload();
  await expect(page.getByText("Paused during draft")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit", exact: true }),
  ).toHaveCount(0);
});

test("restores and submits an embedded form while updating its height", async ({
  page,
}) => {
  const form = await createForm(page);
  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.evaluate((slug) => {
    const frame = document.createElement("iframe");
    frame.id = "draft-frame";
    frame.setAttribute("data-form-forge", "");
    frame.src = `/f/${slug}?embed=1`;
    frame.width = "400";
    frame.height = "640";
    document.body.append(frame);
  }, form.slug);
  await page.addScriptTag({ url: "/embed.js" });
  const frame = page.frameLocator("#draft-frame");
  await frame.getByLabel("Save answers on this device").check();
  await frame
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Embedded save");
  await expect(frame.getByText(/Saved on this device at/)).toBeVisible();
  await expect
    .poll(async () => JSON.stringify(await draftEntries(page)))
    .toContain("Embedded save");
  await page.locator("#draft-frame").evaluate((node) => {
    const iframe = node as HTMLIFrameElement;
    iframe.contentWindow?.location.reload();
  });
  await frame.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    frame.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Embedded save");
  const height = () =>
    page
      .locator("#draft-frame")
      .evaluate((node) => Number.parseInt(node.style.height, 10));
  const before = await height();
  await frame.getByLabel("More details", { exact: true }).check();
  await expect.poll(height).toBeGreaterThan(before);
  await frame.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    frame.getByRole("heading", {
      name: form.schema.settings.successTitle,
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => draftEntries(page)).toEqual([]);
});

for (const condition of ["expired", "corrupt", "unknown format"] as const) {
  test(`rejects a ${condition} local save through the hosted workflow`, async ({
    page,
  }) => {
    const form = await createForm(page);
    await page.goto(`/f/${form.slug}`);
    await page.getByLabel("Save answers on this device").check();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Rejected saved answer");
    await expect
      .poll(async () => JSON.stringify(await draftEntries(page)))
      .toContain("Rejected saved answer");
    await waitSaved(page);
    await page.evaluate((reason) => {
      const entry = Object.entries(localStorage).find(([key]) =>
        key.startsWith("form-forge-draft:"),
      );
      if (!entry) throw new Error("Expected an opt-in draft");
      const [key, raw] = entry;
      const record = JSON.parse(raw);
      if (reason === "corrupt") localStorage.setItem(key, "{broken");
      else
        localStorage.setItem(
          key,
          JSON.stringify({
            ...record,
            ...(reason === "expired"
              ? {
                  createdAt: Date.now() - 8 * 86_400_000,
                  updatedAt: Date.now() - 8 * 86_400_000,
                  expiresAt: Date.now() - 86_400_000,
                }
              : { formatVersion: 999 }),
          }),
        );
    }, condition);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => draftEntries(page)).toEqual([]);
    await expect(
      page.getByText(
        /expired|damaged|unsupported|unrecognized|invalid|removed|discarded/i,
      ),
    ).toBeVisible();
  });
}

for (const condition of ["unavailable", "quota"] as const) {
  test(`shows ${condition} storage failure and keeps ordinary submission usable`, async ({
    page,
  }) => {
    const form = await createForm(page);
    await page.addInitScript((reason) => {
      if (reason === "unavailable") {
        Object.defineProperty(window, "localStorage", {
          get: () => {
            throw new DOMException("Denied", "SecurityError");
          },
        });
      } else {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (this === localStorage && key.startsWith("form-forge-draft:"))
            throw new DOMException("Full", "QuotaExceededError");
          return original.call(this, key, value);
        };
      }
    }, condition);
    await page.goto(`/f/${form.slug}`);
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Storage error response");
    await page.getByLabel("Save answers on this device").click();
    await expect(
      page.getByLabel("Save answers on this device"),
    ).not.toBeChecked();
    await expect(
      page.getByText(
        /could not.*sav|storage.*unavailable|saving.*unavailable|could not.*storage/i,
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: form.schema.settings.successTitle,
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "select count(*)::int as count from submissions where form_id=$1",
          [form.id],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });
}

test("keeps answers and field errors after a server validation failure", async ({
  page,
}) => {
  const form = await createForm(page);
  await page.goto(`/f/${form.slug}`);
  await page.getByLabel("Save answers on this device").check();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Preserved after rejection");
  await page.route(
    `**/api/forms/${form.slug}/submit`,
    async (route) => {
      const body = route.request().postDataJSON();
      await route.continue({
        postData: JSON.stringify({
          ...body,
          values: { ...body.values, name: "" },
        }),
      });
    },
    { times: 1 },
  );
  const failure = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/forms/${form.slug}/submit`),
  );
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  expect((await failure).status()).toBe(422);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Preserved after rejection");
  await expect(page.getByText("This field is required").first()).toBeVisible();
  expect(
    (
      await pool.query(
        "select count(*)::int as count from submissions where form_id=$1",
        [form.id],
      )
    ).rows[0]?.count,
  ).toBe(0);
  await expect
    .poll(async () => JSON.stringify(await draftEntries(page)))
    .toContain("Preserved after rejection");
});

test("invalidates a resumed copy when another tab submits successfully", async ({
  page,
}) => {
  const form = await createForm(page);
  await page.goto(`/f/${form.slug}`);
  await page.getByLabel("Save answers on this device").check();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("One response across tabs");
  await expect
    .poll(async () => JSON.stringify(await draftEntries(page)))
    .toContain("One response across tabs");
  const other = await page.context().newPage();
  await other.goto(`/f/${form.slug}`);
  await other.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: form.schema.settings.successTitle,
      exact: true,
    }),
  ).toBeVisible();
  await expect(other.getByText(/Automatic saving is paused/)).toBeVisible();
  await expect.poll(() => draftEntries(other)).toEqual([]);
  await other.getByRole("button", { name: "Discard", exact: true }).click();
  await other.reload();
  await expect(
    other.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(0);
  await expect(
    other.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("");
  expect(
    (
      await pool.query(
        "select count(*)::int as count from submissions where form_id=$1",
        [form.id],
      )
    ).rows[0]?.count,
  ).toBe(1);
  await other.close();
});

test("keeps save and resume controls keyboard accessible in narrow, wide, light and dark layouts", async ({
  page,
}, testInfo) => {
  const form = await createForm(page);
  await page.goto(`/f/${form.slug}`);
  const save = page.getByLabel("Save answers on this device");
  await save.focus();
  await page.keyboard.press("Space");
  await expect(save).toBeChecked();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Keyboard restoration");
  await expect
    .poll(async () => JSON.stringify(await draftEntries(page)))
    .toContain("Keyboard restoration");
  await page.reload();
  const resume = page.getByRole("button", { name: "Resume", exact: true });
  await resume.focus();
  await expect(resume).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Keyboard restoration");
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["Light theme", "Dark theme"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      await expect(save).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(
          `saving-${width}-${theme.startsWith("Dark") ? "dark" : "light"}.png`,
        ),
        fullPage: true,
      });
    }
  }
});
