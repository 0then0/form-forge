import { describe, expect, it } from "vitest";

import { formSchemaV1Schema } from "./schema";
import { normalizeSubmission } from "./submission";
import type { FormSchemaV1 } from "./types";

const schema: FormSchemaV1 = {
  fields: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      key: "contact_reason",
      label: "Contact reason",
      options: [
        { label: "Sales", value: "sales" },
        { label: "Support", value: "support" },
      ],
      required: true,
      type: "select",
      width: "full",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      key: "company",
      label: "Company",
      required: true,
      type: "shortText",
      visibility: {
        fieldKey: "contact_reason",
        operator: "equals",
        value: "sales",
      },
      webhookKey: "company_name",
      width: "half",
    },
  ],
  schemaVersion: 1,
  settings: {
    submitLabel: "Send",
    successMessage: "We received it.",
    successTitle: "Thanks",
  },
  title: "Contact",
};

describe("FormSchemaV1", () => {
  it("accepts a valid schema", () => {
    expect(formSchemaV1Schema.parse(schema)).toEqual(schema);
  });

  it("rejects visibility references to later fields", () => {
    const invalid = {
      ...schema,
      fields: [schema.fields[1], schema.fields[0]],
    };
    expect(formSchemaV1Schema.safeParse(invalid).success).toBe(false);
  });

  it("removes hidden values and applies webhook keys", () => {
    const result = normalizeSubmission(schema, {
      company: "should not persist",
      contact_reason: "support",
    });
    expect(result).toEqual({
      normalizedValues: { contact_reason: "support" },
      receivedValues: { contact_reason: "support" },
      success: true,
    });
  });

  it("rejects unknown fields", () => {
    const result = normalizeSubmission(schema, {
      contact_reason: "support",
      injected: "value",
    });
    expect(result.success).toBe(false);
  });
});
