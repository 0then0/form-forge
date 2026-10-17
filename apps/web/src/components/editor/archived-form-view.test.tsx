import { defaultFormSchema, type FormSchemaV1 } from "@form-forge/form-schema";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { ArchivedFormView } from "./archived-form-view";

it("shows archived fields and version history without editing or submission actions", async () => {
  const schema: FormSchemaV1 = {
    ...defaultFormSchema(),
    title: "Archived agreement",
    fields: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        key: "consent",
        label: "I accept",
        required: true,
        type: "checkbox",
        width: "full",
        link: { label: "Terms", url: "https://example.com/terms" },
      },
    ],
  };
  render(
    <ArchivedFormView
      schema={schema}
      archivedAt="2026-10-16T10:00:00.000Z"
      formId="form-id"
      draftRevision="2026-10-16T10:00:00.000Z"
      versions={[
        {
          id: "version-id",
          publishedAt: "2026-10-15T10:00:00.000Z",
          schema,
          versionNumber: 1,
        },
      ]}
      initialVersionCursor={null}
      workspaceSlug="workspace"
    />,
  );
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "https://example.com/terms",
  );
  for (const name of [
    "Save draft",
    "Publish",
    "Submit",
    "Archive form",
    "Add field",
  ])
    expect(screen.queryByRole("button", { name })).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Inspect" }));
  expect(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Use as draft",
    }),
  ).toBeDisabled();
});
