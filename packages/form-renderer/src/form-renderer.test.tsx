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
    expect(screen.getByLabelText("Email *")).toHaveAttribute(
      "aria-required",
      "true",
    );
  });

  it("maps server field errors back to their controls", async () => {
    const user = userEvent.setup();
    render(
      <FormRenderer
        schema={schema}
        onSubmit={() =>
          Promise.reject({
            fieldErrors: { email: ["This address is blocked"] },
          })
        }
      />,
    );

    await user.type(screen.getByLabelText("Email *"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      (await screen.findAllByText("This address is blocked")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("Email *")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
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

  it("unregisters a field after it becomes hidden", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <FormRenderer
        schema={{
          ...schema,
          fields: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              key: "kind",
              label: "Kind",
              options: [
                { label: "Business", value: "business" },
                { label: "Personal", value: "personal" },
              ],
              required: true,
              type: "select",
              width: "full",
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              key: "company",
              label: "Company",
              required: false,
              type: "shortText",
              visibility: {
                fieldKey: "kind",
                operator: "equals",
                value: "business",
              },
              width: "full",
            },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Kind *"), "business");
    await user.type(screen.getByLabelText("Company"), "Form Forge");
    await user.selectOptions(screen.getByLabelText("Kind *"), "personal");
    expect(screen.queryByLabelText("Company")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSubmit).toHaveBeenCalledWith({ kind: "personal" });
  });
});

describe("live validation", () => {
  const renderField = (field: import("@form-forge/form-schema").FormField) => {
    const onSubmit = vi.fn();
    render(
      <FormRenderer
        schema={{ ...schema, fields: [field] }}
        onSubmit={onSubmit}
      />,
    );
    return onSubmit;
  };
  const base = {
    id: "22222222-2222-4222-8222-222222222222",
    key: "answer",
    label: "Answer",
    required: false,
    width: "full" as const,
  };

  it("retains invalid optional number input, shows the error while typing, and submits only after correction", async () => {
    const user = userEvent.setup();
    const onSubmit = renderField({
      ...base,
      type: "number",
      validation: { min: 1, max: 10 },
    });
    const input = screen.getByLabelText("Answer");
    await user.type(input, "abc");
    expect(input).toHaveValue("abc");
    expect(screen.getAllByText("Enter a valid number").length).toBeGreaterThan(
      0,
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "11");
    expect(screen.getAllByText("Must be at most 10").length).toBeGreaterThan(0);
    await user.clear(input);
    await user.type(input, "2.5");
    expect(input).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith({ answer: 2.5 });
  });

  it.each([
    [
      "shortText",
      { minLength: 3 },
      "a",
      "Must contain at least 3 characters",
      "abc",
    ],
    ["longText", { pattern: "^[A-Z]+$" }, "lower", "Invalid format", "UPPER"],
    [
      "email",
      undefined,
      "invalid",
      "Enter a valid email address",
      "person@example.com",
    ],
  ] as const)(
    "validates %s during input",
    async (type, validation, invalid, message, valid) => {
      const user = userEvent.setup();
      renderField({ ...base, type, ...(validation ? { validation } : {}) });
      const input = screen.getByLabelText("Answer");
      await user.type(input, invalid);
      expect(screen.getAllByText(message).length).toBeGreaterThan(0);
      await user.clear(input);
      await user.type(input, valid);
      expect(input).not.toHaveAttribute("aria-invalid");
    },
  );

  it("validates date limits on change and clears the error after correction", async () => {
    const user = userEvent.setup();
    renderField({
      ...base,
      type: "date",
      validation: { min: "2026-01-01", max: "2026-12-31" },
    });
    const input = screen.getByLabelText("Answer");
    await user.type(input, "2025-12-31");
    expect(
      screen.getAllByText("Date must be on or after 2026-01-01").length,
    ).toBeGreaterThan(0);
    await user.clear(input);
    await user.type(input, "2026-06-01");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("validates a required select and checkbox immediately after change", async () => {
    const user = userEvent.setup();
    render(
      <FormRenderer
        schema={{
          ...schema,
          fields: [
            {
              ...base,
              required: true,
              type: "select",
              options: [{ label: "Yes", value: "yes" }],
            },
            {
              ...base,
              id: "33333333-3333-4333-8333-333333333333",
              key: "consent",
              label: "Consent",
              required: true,
              type: "checkbox",
            },
          ],
        }}
        onSubmit={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Answer *");
    await user.selectOptions(select, "yes");
    await user.selectOptions(select, "");
    expect(select).toHaveAttribute("aria-invalid", "true");
    const checkbox = screen.getByLabelText("Consent *");
    await user.click(checkbox);
    await user.click(checkbox);
    expect(
      screen.getAllByText("This field must be checked").length,
    ).toBeGreaterThan(0);
  });
});
