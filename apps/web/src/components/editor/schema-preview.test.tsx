import { defaultFormSchema } from "@form-forge/form-schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { SchemaPreview } from "./schema-preview";

it("keeps preview collapsed until requested and preserves it when the schema changes", async () => {
  const schema = { ...defaultFormSchema(), title: "Preview form" };
  const { rerender } = render(
    <SchemaPreview result={{ success: true, data: schema }} />,
  );
  expect(
    screen.getByRole("region", { name: "Form preview" }),
  ).not.toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByText("Preview", { exact: true }));
  expect(screen.getByRole("region", { name: "Form preview" })).toBeVisible();
  rerender(
    <SchemaPreview
      result={{ success: true, data: { ...schema, title: "Updated preview" } }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Updated preview" }),
  ).toBeVisible();
  await user.click(screen.getByText("Preview", { exact: true }));
  expect(
    screen.getByRole("region", { name: "Form preview" }),
  ).not.toBeVisible();
});
