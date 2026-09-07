import { defaultFormSchema } from "@form-forge/form-schema";
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
