import { FormRenderer } from "@form-forge/form-renderer";
import type { FormSchemaV1 } from "@form-forge/form-schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { webRendererComponents } from "./renderer-adapter";

const schema: FormSchemaV1 = {
  fields: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      key: "consent",
      label: "I agree to the terms",
      required: true,
      type: "checkbox",
      width: "full",
    },
  ],
  schemaVersion: 1,
  settings: {
    submitLabel: "Submit",
    successMessage: "Received",
    successTitle: "Thanks",
  },
  title: "Consent",
};

const checkboxField = schema.fields[0];
if (!checkboxField) throw new Error("Missing checkbox fixture");

describe("webRendererComponents", () => {
  it("keeps a checkbox compact and labels it as one control", () => {
    render(
      <FormRenderer
        components={webRendererComponents}
        schema={schema}
        onSubmit={async () => undefined}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "I agree to the terms",
    });
    expect(checkbox).toHaveClass("size-4");
    expect(checkbox).not.toHaveClass("w-full");
    expect(checkbox.parentElement).toHaveClass("flex", "items-center");
  });
});

it("renders an agreement link beside its checkbox and connects its accessible description", () => {
  render(
    <FormRenderer
      components={webRendererComponents}
      schema={{
        ...schema,
        fields: [
          {
            ...checkboxField,
            type: "checkbox",
            link: { label: "User agreement", url: "https://example.com/terms" },
          },
        ],
      }}
      onSubmit={() => undefined}
    />,
  );
  const link = screen.getByRole("link", { name: "User agreement" });
  expect(link).toHaveAttribute("href", "https://example.com/terms");
  expect(link.closest("label")).toBeNull();
  expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(
    "User agreement",
  );
});

it("does not render unsafe agreement links even for an unvalidated schema", () => {
  render(
    <FormRenderer
      components={webRendererComponents}
      schema={{
        ...schema,
        fields: [
          {
            ...checkboxField,
            type: "checkbox",
            link: { label: "Unsafe link", url: "javascript:alert(1)" },
          },
        ],
      }}
      onSubmit={() => undefined}
    />,
  );
  expect(screen.queryByRole("link")).toBeNull();
});
