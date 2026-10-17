import { defaultFormSchema, type FormField } from "@form-forge/form-schema";
import { describe, expect, it } from "vitest";
import { compareSchemas } from "./schema-comparison";

const first: FormField = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "name",
  label: "Name",
  type: "shortText",
  width: "full",
  required: false,
};
const second: FormField = {
  ...first,
  id: "22222222-2222-4222-8222-222222222222",
  key: "email",
  label: "Email",
  type: "email",
};
const schema = { ...defaultFormSchema(), fields: [first, second] };

describe("version comparison", () => {
  it("distinguishes insertion from reordering existing fields", () => {
    const inserted: FormField = {
      ...first,
      id: "33333333-3333-4333-8333-333333333333",
      key: "note",
      label: "Note",
    };
    expect(
      compareSchemas(schema, { ...schema, fields: [first, inserted, second] }),
    ).toMatchObject({ added: 1, changed: 0, removed: 0, orderChanged: false });
    expect(
      compareSchemas(schema, { ...schema, fields: [second, first] }),
    ).toMatchObject({ added: 0, changed: 0, removed: 0, orderChanged: true });
  });

  it("reports field edits, deletions and settings changes separately", () => {
    const diff = compareSchemas(schema, {
      ...schema,
      title: "Changed title",
      fields: [{ ...first, required: true }],
    });
    expect(diff).toMatchObject({
      added: 0,
      changed: 1,
      removed: 1,
      orderChanged: false,
      formSettingsChanged: true,
    });
  });
});
