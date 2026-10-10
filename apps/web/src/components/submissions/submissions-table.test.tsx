import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  test,
  vi,
} from "vitest";

import { SubmissionsTable } from "./submissions-table";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("renders submission cells, appends pages and applies server filters to CSV export", async () => {
  const user = userEvent.setup();
  const requests: URLSearchParams[] = [];
  server.use(
    http.get("/api/admin/workspaces/workspace/submissions", ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      const secondPage = params.has("cursor");
      return HttpResponse.json({
        data: {
          data: [
            {
              id: secondPage ? "second" : "first",
              formId: "form-id",
              formName: secondPage ? "Second form" : "Contact form",
              createdAt: "2026-10-10T09:00:00.000Z",
              deliveryStatus: "succeeded",
              normalizedValues: { name: "Ada", subscribed: true },
              versionNumber: 2,
            },
          ],
          nextCursor:
            secondPage || params.has("deliveryStatus") ? null : "next",
        },
      });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SubmissionsTable
        forms={[{ id: "form-id", name: "Contact form" }]}
        workspaceSlug="workspace"
      />
    </QueryClientProvider>,
  );

  const first = await screen.findByRole("link", { name: "Contact form" });
  expect(first).toHaveAttribute("href", "/app/workspace/submissions/first");
  const row = first.closest("tr");
  expect(row).not.toBeNull();
  if (!row) throw new Error("Submission link must be inside a table row");
  expect(within(row).getByText("v2")).toBeVisible();
  expect(within(row).getByText("name: Ada · subscribed: true")).toBeVisible();
  expect(within(row).getByText("succeeded")).toBeVisible();
  expect(
    screen.getAllByRole("columnheader").map((cell) => cell.textContent),
  ).toEqual(["Form", "Version", "Values", "Delivery", "Received"]);

  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(
    await screen.findByRole("link", { name: "Second form" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Contact form" })).toBeVisible();
  expect(requests.some((params) => params.get("cursor") === "next")).toBe(true);

  await user.selectOptions(
    screen.getByRole("combobox", { name: "Filter by delivery status" }),
    "succeeded",
  );
  await screen.findByRole("link", { name: "Contact form" });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Filter by form" }),
    "form-id",
  );
  await screen.findByRole("link", { name: "Contact form" });
  expect(requests.at(-1)?.get("deliveryStatus")).toBe("succeeded");
  expect(requests.at(-1)?.get("formId")).toBe("form-id");
  expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/api/admin/workspaces/workspace/submissions/export?formId=form-id&deliveryStatus=succeeded",
  );
  expect(screen.queryByRole("link", { name: "Second form" })).toBeNull();
  client.clear();
});

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
