import { expect, test, type APIRequestContext } from "@playwright/test";

const workspaceSlug = process.env.E2E_WORKSPACE_SLUG;
const failureWebhookUrl = process.env.E2E_FAILURE_WEBHOOK_URL;
const successWebhookUrl = process.env.E2E_SUCCESS_WEBHOOK_URL;
const storageState = process.env.PLAYWRIGHT_STORAGE_STATE;

const requireSuccess = async (
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  expectedStatus: number,
) => {
  if (response.status() !== expectedStatus) {
    throw new Error(
      `${response.url()} returned ${response.status()}: ${await response.text()}`,
    );
  }
  return (await response.json()) as { data: Record<string, unknown> };
};

test.describe("delivery recovery", () => {
  test.skip(
    !workspaceSlug || !failureWebhookUrl || !successWebhookUrl || !storageState,
    "Requires an authenticated workspace, public failure/success webhook URLs, and the Inngest Dev Server",
  );

  test("creates, publishes, submits, fails, retries, and succeeds", async ({
    page,
    request,
  }) => {
    test.setTimeout(8 * 60_000);
    const name = `Playwright delivery ${Date.now()}`;
    let formId: string | undefined;

    try {
      const created = await requireSuccess(
        await request.post(`/api/admin/workspaces/${workspaceSlug}/forms`, {
          data: { name },
        }),
        201,
      );
      formId = String(created.data.id);
      const slug = String(created.data.slug);
      const fieldId = crypto.randomUUID();

      await requireSuccess(
        await request.put(
          `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/draft`,
          {
            data: {
              fields: [
                {
                  id: fieldId,
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
            },
          },
        ),
        200,
      );
      await requireSuccess(
        await request.post(
          `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/publish`,
        ),
        201,
      );
      const endpoint = await requireSuccess(
        await request.post(
          `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/webhooks`,
          { data: { name: "Playwright endpoint", url: failureWebhookUrl } },
        ),
        201,
      );
      const endpointId = String(endpoint.data.id);

      await page.goto(`/f/${slug}`);
      await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByRole("status")).toBeVisible();

      await page.goto(
        `/app/${workspaceSlug}/deliveries?formId=${encodeURIComponent(formId)}`,
      );
      const deliveryRow = page.getByRole("row").filter({ hasText: name });
      await expect
        .poll(
          async () => {
            await page.reload();
            return (await deliveryRow.textContent()) ?? "";
          },
          { intervals: [2_000, 5_000], timeout: 3 * 60_000 },
        )
        .toContain("Webhook returned HTTP");

      await requireSuccess(
        await request.patch(
          `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/webhooks/${endpointId}`,
          { data: { enabled: false } },
        ),
        200,
      );
      await expect
        .poll(
          async () => {
            await page.reload();
            return (await deliveryRow.textContent()) ?? "";
          },
          { intervals: [1_000, 2_000], timeout: 30_000 },
        )
        .toContain("failed");

      await requireSuccess(
        await request.patch(
          `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/webhooks/${endpointId}`,
          { data: { enabled: true, url: successWebhookUrl } },
        ),
        200,
      );
      await deliveryRow.getByRole("button", { name: "Retry" }).click();
      await expect
        .poll(
          async () => {
            await page.reload();
            return (await deliveryRow.textContent()) ?? "";
          },
          { intervals: [2_000, 5_000], timeout: 3 * 60_000 },
        )
        .toContain("succeeded");
    } finally {
      if (formId) {
        await request.delete(
          `/api/admin/workspaces/${workspaceSlug}/forms/${formId}`,
        );
      }
    }
  });
});
