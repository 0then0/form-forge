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
});
