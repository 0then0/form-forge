import { render, screen, waitFor, within } from "@testing-library/react";
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

import { ExportTemplateButton } from "./editor/export-template-button";
import { ImportTemplateButton } from "./import-template-button";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const server = setupServer();
const base = "http://localhost:3000/api/admin/workspaces/workspace/forms";
const revision = "2026-11-18T10:00:00.000Z";

const preview = (title: string, digest: string) => ({
  digest,
  formatVersion: 1,
  schemaVersion: 1,
  workspace: { name: "Target", slug: "workspace" },
  title,
  description: null,
  nameInUse: title === "Contact",
  fields: [
    {
      key: "topic",
      label: "Topic",
      type: "select",
      required: true,
      optionCount: 2,
      visibleWhen: null,
    },
    {
      key: "details",
      label: "Details",
      type: "longText",
      required: false,
      optionCount: null,
      visibleWhen: "Topic",
    },
  ],
});

const templateFile = (name: string, content: string) =>
  new File([content], name, { type: "application/json" });

describe("form template actions", () => {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
  });
  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });
  afterAll(() => server.close());

  const renderExport = (dirty: boolean, onSave = vi.fn()) =>
    render(
      <ExportTemplateButton
        canSave={dirty}
        dirty={dirty}
        disabled={false}
        draftRevision={revision}
        formId="form-id"
        saving={false}
        workspaceSlug="workspace"
        onSave={onSave}
      />,
    );

  it("asks to save unsaved changes instead of exporting a stale draft", async () => {
    const onSave = vi.fn();
    renderExport(true, onSave);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("This editor has unsaved changes");
    expect(
      within(dialog).queryByRole("button", { name: /Download/ }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("downloads the saved draft for the editor's revision", async () => {
    let requested: URL | undefined;
    server.use(
      http.get(`${base}/form-id/template`, ({ request }) => {
        requested = new URL(request.url);
        return new HttpResponse('{"format":"form-forge.form-template"}', {
          headers: {
            "Content-Disposition":
              'attachment; filename="contact.form-template.json"',
            "Content-Type": "application/json",
          },
        });
      }),
    );
    const createObjectURL = vi.fn(() => "blob:template");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("contact.form-template.json");
      });
    renderExport(false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Downloads the current saved draft",
    );
    await user.click(
      screen.getByRole("button", { name: "Download saved draft" }),
    );
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(requested?.searchParams.get("revision")).toBe(revision);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports a draft saved in another session instead of downloading it", async () => {
    server.use(
      http.get(`${base}/form-id/template`, () =>
        HttpResponse.json(
          {
            error: {
              code: "CONFLICT",
              message:
                "This draft changed in another session. Reload before continuing.",
            },
          },
          { status: 409 },
        ),
      ),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    renderExport(false);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(
      screen.getByRole("button", { name: "Download saved draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "changed in another session",
    );
    expect(click).not.toHaveBeenCalled();
  });

  const renderImport = () =>
    render(
      <ImportTemplateButton
        disabled={false}
        workspaceName="Target"
        workspaceSlug="workspace"
      />,
    );

  it("previews a file and creates the draft only after confirmation", async () => {
    const previewBodies: string[] = [];
    let imported: { body: string; digest: string | null } | undefined;
    server.use(
      http.post(`${base}/import/preview`, async ({ request }) => {
        const body = await request.text();
        previewBodies.push(body);
        return HttpResponse.json({
          data: preview("Contact", "a".repeat(64)),
        });
      }),
      http.post(`${base}/import`, async ({ request }) => {
        imported = {
          body: await request.text(),
          digest: new URL(request.url).searchParams.get("digest"),
        };
        return HttpResponse.json({ data: { id: "new-form" } }, { status: 201 });
      }),
    );
    renderImport();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Import" }));
    const create = screen.getByRole("button", { name: "Create draft" });
    expect(create).toBeDisabled();
    await user.upload(
      screen.getByLabelText("Template file"),
      templateFile("contact.json", '{"first":true}'),
    );
    const summary = await screen.findByRole("region", {
      name: "Template preview",
    });
    expect(summary).toHaveTextContent("Contact");
    expect(summary).toHaveTextContent("2 fields");
    expect(summary).toHaveTextContent("Topic · Select · required · 2 options");
    expect(summary).toHaveTextContent("shown depending on Topic");
    expect(summary).toHaveTextContent("already exists in this workspace");
    expect(imported).toBeUndefined();

    await user.click(create);
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/app/workspace/forms/new-form"),
    );
    expect(previewBodies).toEqual(['{"first":true}']);
    expect(imported).toEqual({
      body: '{"first":true}',
      digest: "a".repeat(64),
    });
  });

  it("requires a new preview when the file changes", async () => {
    let releaseSecond: () => void = () => {};
    const digests: (string | null)[] = [];
    server.use(
      http.post(`${base}/import/preview`, async ({ request }) => {
        const body = await request.text();
        if (body.includes("second")) {
          await new Promise<void>((resolve) => {
            releaseSecond = resolve;
          });
          return HttpResponse.json({ data: preview("Second", "b".repeat(64)) });
        }
        return HttpResponse.json({ data: preview("First", "a".repeat(64)) });
      }),
      http.post(`${base}/import`, ({ request }) => {
        digests.push(new URL(request.url).searchParams.get("digest"));
        return HttpResponse.json({ data: { id: "new-form" } }, { status: 201 });
      }),
    );
    renderImport();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Import" }));
    const input = screen.getByLabelText("Template file");
    await user.upload(input, templateFile("first.json", '{"first":true}'));
    await screen.findByText("First");
    await user.upload(input, templateFile("second.json", '{"second":true}'));
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
    releaseSecond();
    await screen.findByText("Second");
    await user.click(screen.getByRole("button", { name: "Create draft" }));
    await waitFor(() => expect(digests).toEqual(["b".repeat(64)]));
  });

  it("forgets the previewed file when the dialog is cancelled", async () => {
    server.use(
      http.post(`${base}/import/preview`, () =>
        HttpResponse.json({ data: preview("First", "a".repeat(64)) }),
      ),
    );
    renderImport();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.upload(
      screen.getByLabelText("Template file"),
      templateFile("first.json", '{"first":true}'),
    );
    await screen.findByText("First");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  });

  it("rejects oversized files before upload and shows validation details", async () => {
    let previews = 0;
    server.use(
      http.post(`${base}/import/preview`, () => {
        previews += 1;
        return HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "The template does not contain a valid form definition",
              fieldErrors: {
                "form.fields.1.visibility.fieldKey": [
                  "Visibility must reference an existing field",
                ],
              },
            },
          },
          { status: 422 },
        );
      }),
    );
    renderImport();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Import" }));
    const input = screen.getByLabelText("Template file");
    const large = templateFile("large.json", "{}");
    Object.defineProperty(large, "size", { value: 16_000_001 });
    await user.upload(input, large);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The file is larger than 16 MB.",
    );
    expect(previews).toBe(0);

    await user.upload(input, templateFile("broken.json", "{}"));
    const alert = await screen.findByText(
      "The template does not contain a valid form definition",
    );
    expect(alert.parentElement).toHaveTextContent(
      "form.fields.1.visibility.fieldKey: Visibility must reference an existing field",
    );
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
  });
});
