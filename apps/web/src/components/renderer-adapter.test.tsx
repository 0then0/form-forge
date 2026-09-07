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
