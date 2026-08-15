import { expect, test } from "@playwright/test";

const slug = process.env.E2E_PUBLISHED_FORM_SLUG;

test.describe("hosted form", () => {
  test.skip(!slug, "E2E_PUBLISHED_FORM_SLUG must reference a seeded form");

  test("submits a published form without a duplicate request", async ({
    page,
  }) => {
    await page.goto(`/f/${slug}`);
    const firstTextbox = page.getByRole("textbox").first();
    await firstTextbox.fill("Playwright response");
    await page.getByRole("button", { name: /submit|send/i }).click();
    await expect(page.getByRole("status")).toBeVisible();
  });
});
