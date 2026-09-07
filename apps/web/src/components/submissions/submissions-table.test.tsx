import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubmissionsTable } from "./submissions-table";

const renderTable = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SubmissionsTable
        forms={[{ id: "form-id", name: "Contact" }]}
        workspaceSlug="workspace"
      />
    </QueryClientProvider>,
  );
};

describe("SubmissionsTable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves the active filters in the CSV export link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: { data: [], nextCursor: null } }),
            {
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("No submissions");
    await user.selectOptions(
      screen.getByLabelText("Filter by form"),
      "form-id",
    );
    await user.selectOptions(
      screen.getByLabelText("Filter by delivery status"),
      "failed",
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
        "href",
        "/api/admin/workspaces/workspace/submissions/export?formId=form-id&deliveryStatus=failed",
      );
    });
  });
});
