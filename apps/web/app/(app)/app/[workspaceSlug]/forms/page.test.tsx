import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listArchivedForms: vi.fn(),
  listActiveForms: vi.fn(),
}));
vi.mock("@/auth/permissions", () => ({
  canEdit: () => true,
  requireWorkspace: async () => ({ role: "owner" }),
}));
vi.mock("@/services/forms", () => mocks);
vi.mock("@/components/create-form-button", () => ({
  CreateFormButton: () => <button type="button">New form</button>,
}));
vi.mock("@/components/form-list-actions", () => ({
  FormListActions: () => null,
}));
import FormsPage from "./page";

it("shows the archive date separately from the last content save", async () => {
  mocks.listArchivedForms.mockResolvedValue([
    {
      id: "form-id",
      name: "Contact",
      slug: "contact",
      status: "archived",
      publishedVersionId: null,
      updatedAt: new Date("2026-10-16T14:00:00.000Z"),
      archivedAt: new Date("2026-10-16T14:00:00.000Z"),
      lastSavedAt: new Date("2026-10-14T10:00:00.000Z"),
    },
  ]);
  render(
    await FormsPage({
      params: Promise.resolve({ workspaceSlug: "workspace" }),
      searchParams: Promise.resolve({ archived: "1" }),
    }),
  );
  expect(
    screen
      .getByText("Archived", { selector: "dt" })
      .nextElementSibling?.querySelector("time"),
  ).toHaveAttribute("datetime", "2026-10-16T14:00:00.000Z");
  expect(
    screen.getByText("Last saved").nextElementSibling?.querySelector("time"),
  ).toHaveAttribute("datetime", "2026-10-14T10:00:00.000Z");
  expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute(
    "href",
    "/app/workspace/forms/form-id",
  );
  expect(mocks.listActiveForms).not.toHaveBeenCalled();
});
