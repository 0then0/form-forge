import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("renders one cursor page and applies server filters to CSV export for a viewer", async () => {
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
              processingStatus: "new",
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
        canEdit={false}
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
  expect(within(row).getAllByRole("link")).toHaveLength(1);
  expect(within(row).getByText("v2")).toBeVisible();
  expect(within(row).getByText("name: Ada · subscribed: true")).toBeVisible();
  expect(within(row).getByText("succeeded")).toBeVisible();
  expect(within(row).queryByRole("checkbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Mark as processed/ }),
  ).toBeNull();
  expect(
    screen.getAllByRole("columnheader").map((cell) => cell.textContent),
  ).toEqual([
    "Form",
    "Version",
    "Values",
    "Processing",
    "Delivery",
    "Received",
  ]);

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(
    await screen.findByRole("link", { name: "Second form" }),
  ).toBeVisible();
  expect(screen.queryByRole("link", { name: "Contact form" })).toBeNull();
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
  expect(requests.at(-1)?.has("cursor")).toBe(false);
  expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/api/admin/workspaces/workspace/submissions/export?formId=form-id&deliveryStatus=succeeded",
  );
  expect(screen.queryByRole("link", { name: "Second form" })).toBeNull();
  client.clear();
});

const renderTable = (
  canEdit = false,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) =>
  render(
    <QueryClientProvider client={queryClient}>
      <SubmissionsTable
        canEdit={canEdit}
        forms={[
          { id: "form-id", name: "Contact" },
          { id: "other-form", name: "Feedback" },
        ]}
        workspaceSlug="workspace"
      />
    </QueryClientProvider>,
  );

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

  it("scopes the selection to one form and clears it when filters change", async () => {
    const requests: unknown[] = [];
    let releaseRequest: (() => void) | undefined;
    const pendingRequest = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let processed = false;
    server.use(
      http.get("/api/admin/workspaces/workspace/submissions", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const formId = params.get("formId");
        const data = [
          { id: "first", formId: "form-id", formName: "Contact" },
          { id: "second", formId: "form-id", formName: "Contact" },
          { id: "other", formId: "other-form", formName: "Feedback" },
        ]
          .filter((row) => !formId || row.formId === formId)
          .filter(
            (row) =>
              !processed ||
              row.id !== "first" ||
              params.get("processingStatus") !== "new",
          )
          .map((row) => ({
            ...row,
            createdAt: "2026-10-10T09:00:00.000Z",
            deliveryStatus: "succeeded",
            processingStatus: "new",
            normalizedValues: {},
            versionNumber: 1,
          }));
        return HttpResponse.json({ data: { data, nextCursor: null } });
      }),
      http.post(
        "/api/admin/workspaces/workspace/submissions/mark-processed",
        async ({ request }) => {
          requests.push(await request.json());
          await pendingRequest;
          processed = true;
          return HttpResponse.json({ data: { updatedCount: 1 } });
        },
      ),
    );

    const user = userEvent.setup();
    renderTable(true);
    const first = () =>
      screen.getByRole("checkbox", { name: "Select response first" });
    await user.click(
      await screen.findByRole("checkbox", { name: "Select response first" }),
    );
    expect(first()).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select response other" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("checkbox", { name: "Select this page" }),
    ).toBeNull();

    await user.selectOptions(
      screen.getByLabelText("Filter by form"),
      "form-id",
    );
    await screen.findByRole("checkbox", { name: "Select this page" });
    expect(first()).not.toBeChecked();
    await user.click(first());
    await user.selectOptions(
      screen.getByLabelText("Filter by processing status"),
      "new",
    );
    await screen.findByRole("checkbox", { name: "Select this page" });
    expect(first()).not.toBeChecked();
    await user.click(first());

    await user.click(
      screen.getByRole("button", { name: "Mark as processed (1)" }),
    );
    try {
      const pending = await screen.findByRole("button", {
        name: "Marking as processed…",
      });
      expect(pending).toBeDisabled();
      await user.click(pending);
      await waitFor(() =>
        expect(requests).toEqual([
          { formId: "form-id", submissionIds: ["first"] },
        ]),
      );
    } finally {
      releaseRequest?.();
    }
    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", { name: "Select response first" }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Select response second" }),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Filter by processing status")).toHaveValue(
      "new",
    );
    expect(requests).toHaveLength(1);
  });

  it("keeps the selection cleared when a response returns to the current page", async () => {
    const client = new QueryClient();
    let pageId = "selected";
    server.use(
      http.get("/api/admin/workspaces/workspace/submissions", () =>
        HttpResponse.json({
          data: {
            data: [
              {
                id: pageId,
                formId: "form-id",
                formName: "Contact",
                createdAt: "2026-10-10T09:00:00.000Z",
                deliveryStatus: "succeeded",
                processingStatus: "new",
                normalizedValues: {},
                versionNumber: 1,
              },
            ],
            nextCursor: "next",
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderTable(true, client);
    const selectionLabel = "Select response selected";
    await user.click(
      await screen.findByRole("checkbox", { name: selectionLabel }),
    );

    const reloadWith = async (id: string) => {
      pageId = id;
      await act(async () => {
        await client.refetchQueries({ queryKey: ["submissions", "workspace"] });
      });
    };
    await reloadWith("replacement");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Review your selection",
    );
    await reloadWith("selected");
    expect(
      await screen.findByRole("checkbox", { name: selectionLabel }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Mark as processed (0)" }),
    ).toBeDisabled();
  });
});
