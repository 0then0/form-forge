import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FormRenderer } from "./form-renderer";

const schema = {
  fields: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      key: "email",
      label: "Email",
      required: true,
      type: "email" as const,
      width: "full" as const,
    },
  ],
  schemaVersion: 1 as const,
  settings: {
    submitLabel: "Send",
    successMessage: "Received",
    successTitle: "Thanks",
  },
  title: "Contact",
};

describe("FormRenderer", () => {
  it("renders semantic fields and submits normalized values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FormRenderer schema={schema} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Email *"), "USER@EXAMPLE.COM");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith({ email: "user@example.com" });
  });

  it("shows required validation without calling submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FormRenderer schema={schema} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getAllByRole("alert")).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses normalized numbers for conditional visibility", async () => {
    const user = userEvent.setup();
    render(
      <FormRenderer
        schema={{
          ...schema,
          fields: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              key: "age",
              label: "Age",
              required: true,
              type: "number",
              width: "full",
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              key: "adult_note",
              label: "Adult note",
              required: false,
              type: "shortText",
              visibility: {
                fieldKey: "age",
                operator: "equals",
                value: 18,
              },
              width: "full",
            },
          ],
        }}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Adult note")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Age *"), "18");
    expect(screen.getByLabelText("Adult note")).toBeInTheDocument();
  });

  it("treats a cleared optional number as empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <FormRenderer
        schema={{
          ...schema,
          fields: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              key: "age",
              label: "Age",
              required: false,
              type: "number",
              width: "full",
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              key: "empty_note",
              label: "Empty note",
              required: false,
              type: "shortText",
              visibility: { fieldKey: "age", operator: "isEmpty" },
              width: "full",
            },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );

    const age = screen.getByLabelText("Age");
    expect(screen.getByLabelText("Empty note")).toBeInTheDocument();
    await user.type(age, "18");
    expect(screen.queryByLabelText("Empty note")).not.toBeInTheDocument();
    await user.clear(age);
    expect(screen.getByLabelText("Empty note")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith({});
  });
});
