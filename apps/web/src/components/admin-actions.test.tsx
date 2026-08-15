import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { RetryButton } from "./deliveries/retry-button";
import { MembersManager } from "./members-manager";
import { WebhookEndpointCard } from "./webhooks/webhook-endpoint-card";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const server = setupServer();

describe("admin actions", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    router.refresh.mockReset();
  });
  afterAll(() => server.close());

  it("does not offer retry for an unavailable endpoint", async () => {
    const user = userEvent.setup();
    render(
      <RetryButton
        deliveryId="delivery-id"
        disabled
        workspaceSlug="workspace"
      />,
    );

    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("disables an enabled webhook endpoint through the admin contract", async () => {
    let requestBody: unknown;
    server.use(
      http.patch(
        "/api/admin/workspaces/workspace/forms/form-id/webhooks/endpoint-id",
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({ data: { id: "endpoint-id" } });
        },
      ),
    );
    const user = userEvent.setup();
    render(
      <WebhookEndpointCard
        canManage
        endpoint={{
          enabled: true,
          id: "endpoint-id",
          name: "Primary",
          url: "https://example.com/webhook",
        }}
        formId="form-id"
        workspaceSlug="workspace"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Disable" }));

    expect(requestBody).toEqual({ enabled: false });
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("renders membership controls as read-only for non-owners", () => {
    render(
      <MembersManager
        canManage={false}
        currentUserId="viewer-id"
        initialMembers={[
          {
            email: "viewer@example.com",
            name: "Viewer",
            role: "viewer",
            userId: "viewer-id",
          },
        ]}
        workspaceSlug="workspace"
      />,
    );

    expect(screen.getByText("viewer")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });
});
