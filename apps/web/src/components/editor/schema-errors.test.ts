import { defaultFormSchema, formSchemaV1Schema } from "@form-forge/form-schema";
import { expect, it } from "vitest";
import { formatSchemaIssues } from "./schema-errors";

it("explains missing field labels without raw Zod messages or internal paths", () => {
  const draft = {
    ...defaultFormSchema(),
    fields: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        key: "name",
        type: "shortText",
        width: "full",
        required: false,
        label: "",
      },
    ],
  };
  const parsed = formSchemaV1Schema.safeParse(draft);
  if (parsed.success) throw new Error("Expected an invalid label");
  expect(formatSchemaIssues(parsed.error, draft)).toEqual([
    "Field 1: Enter the field label.",
  ]);
});

it("identifies the field and explains how to fix its agreement link", () => {
  const draft = {
    ...defaultFormSchema(),
    fields: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        key: "consent",
        type: "checkbox",
        width: "full",
        required: false,
        label: "Consent",
        link: { label: "Terms", url: "javascript:alert(1)" },
      },
    ],
  };
  const parsed = formSchemaV1Schema.safeParse(draft);
  if (parsed.success) throw new Error("Expected an invalid link");
  expect(formatSchemaIssues(parsed.error, draft)).toEqual([
    "Field 1 “Consent”: Enter a full http:// or https:// link without a username or password.",
  ]);
});
