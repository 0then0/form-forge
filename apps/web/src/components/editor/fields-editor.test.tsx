import { defaultFormSchema, type FormSchemaV1 } from "@form-forge/form-schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { FieldsEditor } from "./fields-editor";

const Harness = ({
  initialSchema = defaultFormSchema(),
  onSave = vi.fn(),
}: {
  initialSchema?: FormSchemaV1;
  onSave?: (schema: FormSchemaV1) => void;
}) => {
  const form = useForm<FormSchemaV1>({ defaultValues: initialSchema });
  return (
    <form onSubmit={form.handleSubmit(onSave)}>
      <FieldsEditor form={form} canEdit />
      <button type="submit">Save</button>
    </form>
  );
};

describe("FieldsEditor", () => {
  it("shows one insertion control when empty, then one at every field boundary", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getAllByRole("button", { name: /Add field/ })).toHaveLength(
      1,
    );
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(screen.getAllByRole("button", { name: /Add field/ })).toHaveLength(
      2,
    );
    await user.click(
      screen.getByRole("button", { name: "Add field after field 1" }),
    );
    expect(screen.getAllByRole("button", { name: /Add field/ })).toHaveLength(
      3,
    );
    const [remove] = screen.getAllByRole("button", { name: "Remove field" });
    if (!remove) throw new Error("Missing remove button");
    await user.click(remove);
    expect(screen.getAllByRole("button", { name: /Add field/ })).toHaveLength(
      2,
    );
  });

  it("inserts fields at the requested position", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "Original");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(
      screen
        .getAllByLabelText("Label")
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(["New field", "Original"]);
    await user.click(
      screen.getByRole("button", { name: "Add field after field 1" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      onSave.mock.calls[0]?.[0].fields.map(
        (field: { label: string }) => field.label,
      ),
    ).toEqual(["New field", "New field", "Original"]);
  });

  it("edits, reorders and removes select options without losing focus or values", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.selectOptions(screen.getByLabelText("Type"), "select");
    const label = screen.getByLabelText("Option 1 label");
    await user.clear(label);
    await user.type(label, "First choice");
    expect(label).toHaveFocus();
    expect(label).toHaveValue("First choice");
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.clear(screen.getByLabelText("Option 2 label"));
    await user.type(screen.getByLabelText("Option 2 label"), "Second choice");
    await user.click(screen.getByRole("button", { name: "Move option 2 up" }));
    expect(screen.getByLabelText("Option 1 label")).toHaveValue(
      "Second choice",
    );
    await user.click(screen.getByRole("button", { name: "Remove option 2" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0].fields[0].options).toEqual([
      { label: "Second choice", value: "option_2" },
    ]);
  });
});

it("adds, edits and removes a checkbox agreement link", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<Harness onSave={onSave} />);
  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.selectOptions(screen.getByLabelText("Type"), "checkbox");
  await user.click(screen.getByRole("button", { name: "Add link" }));
  await user.clear(screen.getByLabelText("Link text"));
  await user.type(screen.getByLabelText("Link text"), "User agreement");
  await user.type(
    screen.getByLabelText("Link URL"),
    "https://example.com/terms",
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave.mock.calls[0]?.[0].fields[0]).toMatchObject({
    type: "checkbox",
    link: { label: "User agreement", url: "https://example.com/terms" },
  });
  await user.click(screen.getByRole("button", { name: "Remove link" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave.mock.calls.at(-1)?.[0].fields[0].link).toBeUndefined();
});
