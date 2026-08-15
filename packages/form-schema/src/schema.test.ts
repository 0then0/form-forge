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

  it("keeps number visibility typed consistently", () => {
    const numberSchema: FormSchemaV1 = {
      ...schema,
      fields: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          key: "age",
          label: "Age",
          required: true,
          type: "number",
          width: "full",
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          key: "adult_note",
          label: "Adult note",
          required: true,
          type: "shortText",
          visibility: { fieldKey: "age", operator: "equals", value: 18 },
          width: "full",
        },
      ],
    };
    expect(formSchemaV1Schema.safeParse(numberSchema).success).toBe(true);
    expect(
      normalizeSubmission(numberSchema, { age: 18, adult_note: "yes" }),
    ).toMatchObject({
      receivedValues: { adult_note: "yes", age: 18 },
      success: true,
    });
  });

  it("rejects visibility values that do not match the source field", () => {
    const invalid = {
      ...schema,
      fields: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          key: "age",
          label: "Age",
          required: true,
          type: "number" as const,
          width: "full" as const,
        },
        {
          ...schema.fields[1],
          visibility: { fieldKey: "age", operator: "equals", value: "18" },
        },
      ],
    };
    expect(formSchemaV1Schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects regex patterns outside the bounded safe subset", () => {
    const invalid = {
      ...schema,
      fields: [
        {
          ...schema.fields[1],
          validation: { pattern: "^(a|aa)+$" },
          visibility: undefined,
        },
      ],
    };
    expect(formSchemaV1Schema.safeParse(invalid).success).toBe(false);
    expect(
      formSchemaV1Schema.safeParse({
        ...invalid,
        fields: [
          {
            ...schema.fields[1],
            validation: {
              pattern: "^a{0,256}a{0,256}a{0,256}a{0,256}b$",
            },
            visibility: undefined,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      formSchemaV1Schema.safeParse({
        ...invalid,
        fields: [
          {
            ...schema.fields[1],
            validation: { pattern: "^[A-Z].*$" },
            visibility: undefined,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
