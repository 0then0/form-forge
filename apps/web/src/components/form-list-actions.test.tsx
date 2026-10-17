import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { FormListActions } from "./form-list-actions";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const server = setupServer();
const form = {
  id: "form-id",
  name: "Contact",
  slug: "contact",
  status: "draft",
  updatedAt: "2026-10-16T10:00:00.000Z",
};
const renderActions = (status = "draft", canDelete = true) =>
  render(
    <FormListActions
      form={{ ...form, status }}
      workspaceSlug="workspace"
      canEdit
      canDelete={canDelete}
    />,
  );

describe("FormListActions", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  beforeEach(() => {
    router.refresh.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => server.close());

  it("offers the public form link for published forms", () => {
    renderActions("published");
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/f/contact",
    );
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("publishes the saved draft with its revision from the list", async () => {
    let body: unknown;
    server.use(
      http.post(
        "/api/admin/workspaces/workspace/forms/form-id/publish",
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: {} });
        },
      ),
    );
    renderActions();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Publish" }));
    expect(body).toEqual({ expectedRevision: form.updatedAt });
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("restores archived forms", async () => {
    server.use(
      http.post("/api/admin/workspaces/workspace/forms/form-id/restore", () =>
        HttpResponse.json({ data: {} }),
      ),
    );
    renderActions("archived");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Restore" }));
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("requires the exact form name before permanent deletion", async () => {
    let body: unknown;
    server.use(
      http.delete(
        "/api/admin/workspaces/workspace/forms/form-id/permanent",
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ data: {} });
        },
      ),
    );
    const user = userEvent.setup();
    renderActions("archived");
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );
    const submit = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Delete permanently",
    });
    expect(submit).toBeDisabled();
    await user.type(
      screen.getByLabelText("Type the form name to confirm"),
      "Contact",
    );
    await user.click(submit);
    expect(body).toEqual({ confirmation: "Contact" });
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("does not offer permanent deletion to editors", () => {
    renderActions("archived", false);
    expect(
      screen.queryByRole("button", { name: "Delete permanently" }),
    ).toBeNull();
  });

  it("surfaces publish validation failures", async () => {
    server.use(
      http.post("/api/admin/workspaces/workspace/forms/form-id/publish", () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Add at least one field before publishing",
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderActions();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add at least one field before publishing",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
