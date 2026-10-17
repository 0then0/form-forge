import { defaultFormSchema, formSchemaV1Schema } from "@form-forge/form-schema";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VersionHistory } from "./version-history";

const schema = defaultFormSchema();
const version = {
  id: "11111111-1111-4111-8111-111111111111",
  publishedAt: "2026-08-15T18:30:00.000Z",
  schema,
  versionNumber: 1,
};

describe("VersionHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not report differences caused by JSON key order", async () => {
    const storedSchema = {
      title: "Contact",
      settings: {
        successTitle: "Thanks",
        successMessage: "Received",
        submitLabel: "Submit",
      },
      schemaVersion: 1 as const,
      fields: [
        {
          width: "full" as const,
          type: "shortText" as const,
          required: false,
          label: "Name",
          key: "name",
          id: "11111111-1111-4111-8111-111111111111",
        },
      ],
    };
    render(
      <VersionHistory
        canEdit
        currentSchema={formSchemaV1Schema.parse(storedSchema)}
        draftRevision={version.publishedAt}
        formId="form-id"
        initialCursor={null}
        onRestore={vi.fn()}
        versions={[{ ...version, schema: storedSchema }]}
        workspaceSlug="workspace"
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Inspect" }));
    expect(
      screen.getByText(/0 added, 0 changed, 0 removed fields/),
    ).toBeVisible();
    expect(screen.queryByText(/Form settings changed/)).not.toBeInTheDocument();
  });

  it("shows readable changes and keeps schema JSON collapsed", async () => {
    const field = {
      id: "22222222-2222-4222-8222-222222222222",
      key: "name",
      label: "Name",
      required: false,
      type: "shortText" as const,
      width: "full" as const,
    };
    const before = { ...schema, title: "Contact", fields: [field] };
    const after = {
      ...before,
      title: "Feedback",
      fields: [{ ...field, label: "Full name", required: true }],
    };
    render(
      <VersionHistory
        canEdit
        currentSchema={after}
        draftRevision={version.publishedAt}
        formId="form-id"
        initialCursor={null}
        onRestore={vi.fn()}
        versions={[{ ...version, schema: before }]}
        workspaceSlug="workspace"
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Inspect" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Form settings", { exact: true })).toBeVisible();
    expect(dialog.getByText("Contact", { exact: true })).toBeVisible();
    expect(dialog.getByText("Feedback", { exact: true })).toBeVisible();
    expect(dialog.getByText("Changed", { exact: true })).toBeVisible();
    expect(dialog.getByText("Required", { exact: true })).toBeVisible();
    expect(dialog.getByText("No", { exact: true })).toBeVisible();
    expect(dialog.getByText("Yes", { exact: true })).toBeVisible();
    expect(
      dialog.getByRole("region", { name: "Version 1 schema JSON" }),
    ).not.toBeVisible();
    await userEvent
      .setup()
      .click(dialog.getByText("Schema JSON", { exact: true }));
    expect(
      dialog.getByRole("region", { name: "Version 1 schema JSON" }),
    ).toBeVisible();
  });

  it("does not duplicate an already loaded version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [version] }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const user = userEvent.setup();
    render(
      <VersionHistory
        canEdit
        currentSchema={schema}
        draftRevision="2026-08-15T18:30:00.000Z"
        formId="22222222-2222-4222-8222-222222222222"
        initialCursor={1}
        onRestore={vi.fn()}
        versions={[version]}
        workspaceSlug="workspace"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Load older versions" }),
    );

    expect(await screen.findByText("Version 1")).toBeVisible();
    expect(screen.getAllByText("Version 1")).toHaveLength(1);
  });
});
