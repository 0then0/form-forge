import type { FormSchemaV1 } from "@form-forge/form-schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
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

import { SchemaEditor } from "./schema-editor";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const server = setupServer();
const revision = "2026-08-15T12:00:00.000Z";
const schema: FormSchemaV1 = {
  fields: [
    {
      id: "11111111-1111-4111-8111-111111111111",
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
    successMessage: "Received",
    successTitle: "Thanks",
  },
  title: "Contact",
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

describe("SchemaEditor", () => {
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

  it("publishes the displayed schema and expected revision atomically", async () => {
    let requestBody: unknown;
    let draftSaveCount = 0;
    server.use(
      http.put("/api/admin/workspaces/workspace/forms/form-id/draft", () => {
        draftSaveCount += 1;
        return HttpResponse.json({ data: {} });
      }),
      http.post(
        "/api/admin/workspaces/workspace/forms/form-id/publish",
        async ({ request }) => {
          requestBody = await request.json();
          return HttpResponse.json({
            data: {
              draftRevision: "2026-08-15T12:01:00.000Z",
              versionNumber: 1,
            },
          });
        },
      ),
    );
    const user = userEvent.setup();
    render(
      <SchemaEditor
        canEdit
        formId="form-id"
        initialDraftRevision={revision}
        initialSchema={schema}
        publicBaseUrl="http://localhost:3000"
        publicSlug="contact"
        published={false}
        versions={[]}
        workspaceSlug="workspace"
      />,
      { wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await screen.findByText("Version 1 published");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(requestBody).toMatchObject({
      expectedRevision: revision,
      schema: {
        fields: [{ id: schema.fields[0]?.id, key: "name", label: "Name" }],
        title: "Contact",
      },
    });
    expect(draftSaveCount).toBe(0);
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  });

  it("does not offer publishing for an unchanged published schema", () => {
    render(
      <SchemaEditor
        canEdit
        formId="form-id"
        initialDraftRevision={revision}
        initialSchema={schema}
        publicBaseUrl="http://localhost:3000"
        publicSlug="contact"
        published
        versions={[
          {
            id: "version-id",
            publishedAt: revision,
            schema,
            versionNumber: 1,
          },
        ]}
        workspaceSlug="workspace"
      />,
      { wrapper },
    );

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("surfaces publish conflicts without saving the draft", async () => {
    server.use(
      http.post("/api/admin/workspaces/workspace/forms/form-id/publish", () =>
        HttpResponse.json(
          {
            error: {
              code: "CONFLICT",
              message: "This draft changed in another session",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <SchemaEditor
        canEdit
        formId="form-id"
        initialDraftRevision={revision}
        initialSchema={schema}
        publicBaseUrl="http://localhost:3000"
        publicSlug="contact"
        published={false}
        versions={[]}
        workspaceSlug="workspace"
      />,
      { wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(
      await screen.findByText("This draft changed in another session"),
    ).toBeVisible();
  });

  it("shows structured server field errors", async () => {
    server.use(
      http.post("/api/admin/workspaces/workspace/forms/form-id/publish", () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              fieldErrors: {
                "schema.fields.0.label": ["Label is already reserved"],
              },
              message: "The request contains invalid data",
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(
      <SchemaEditor
        canEdit
        formId="form-id"
        initialDraftRevision={revision}
        initialSchema={schema}
        publicBaseUrl="http://localhost:3000"
        publicSlug="contact"
        published={false}
        versions={[]}
        workspaceSlug="workspace"
      />,
      { wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText(/Label is already reserved/)).toBeVisible();
  });
});
