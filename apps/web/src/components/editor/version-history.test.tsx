import { defaultFormSchema, formSchemaV1Schema } from "@form-forge/form-schema";
import { render, screen } from "@testing-library/react";
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
