import { expect, test } from "@playwright/test";

const slug = process.env.E2E_PUBLISHED_FORM_SLUG;

test.describe("hosted form", () => {
  test.skip(!slug, "E2E_PUBLISHED_FORM_SLUG must reference a seeded form");

  test("submits a published form idempotently and rejects a foreign version", async ({
    page,
    request,
  }) => {
    await page.goto(`/f/${slug}`);
    const firstTextbox = page.getByRole("textbox").first();
    await firstTextbox.fill("Playwright response");
    const submittedRequestPromise = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        candidate.url().includes(`/api/forms/${slug}/submit`),
    );
    await page.getByRole("button", { name: /submit|send/i }).click();
    const submittedRequest = await submittedRequestPromise;
    await expect(page.getByRole("status")).toBeVisible();

    const idempotencyKey = submittedRequest.headers()["idempotency-key"];
    expect(idempotencyKey).toBeTruthy();
    const originalBody = submittedRequest.postDataJSON() as {
      versionId: string;
      values: Record<string, unknown>;
    };
    const duplicate = await request.post(submittedRequest.url(), {
      data: originalBody,
      headers: { "Idempotency-Key": idempotencyKey ?? "" },
    });
    expect(duplicate.status()).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      data: { duplicate: true },
    });

    const wrongVersion = await request.post(submittedRequest.url(), {
      data: { ...originalBody, versionId: crypto.randomUUID() },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    expect(wrongVersion.status()).toBe(404);
  });
});
