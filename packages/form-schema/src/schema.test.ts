import { describe, expect, it } from "vitest";

import { formSchemaV1Schema, submissionRequestSchema } from "./schema";
import {
  MAX_LONG_TEXT_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUBMISSION_FIELDS,
  MAX_SUBMISSION_TEXT_LENGTH,
} from "./limits";
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

  it("bounds field count and text independently of form validation", () => {
    expect(
      submissionRequestSchema.safeParse({
        versionId: "11111111-1111-4111-8111-111111111111",
        values: Object.fromEntries(
          Array.from({ length: MAX_SUBMISSION_FIELDS + 1 }, (_, index) => [
            `field_${index}`,
            "value",
          ]),
        ),
      }).success,
    ).toBe(false);

    const shortText = schema.fields[1];
    if (!shortText) throw new Error("Expected a short text field");
    const { visibility: _visibility, ...visibleShortText } = shortText;
    expect(
      normalizeSubmission(
        { ...schema, fields: [visibleShortText] },
        { company: "x".repeat(MAX_SHORT_TEXT_LENGTH + 1) },
      ),
    ).toMatchObject({ success: false });

    const longTextSchema: FormSchemaV1 = {
      ...schema,
      fields: Array.from({ length: 7 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        key: `note_${index}`,
        label: `Note ${index}`,
        required: true,
        type: "longText" as const,
        width: "full" as const,
      })),
    };
    const aggregate = normalizeSubmission(
      longTextSchema,
      Object.fromEntries(
        longTextSchema.fields.map((field) => [
          field.key,
          "x".repeat(MAX_LONG_TEXT_LENGTH),
        ]),
      ),
    );
    expect(aggregate).toEqual({
      errors: [
        {
          field: "_root",
          message: `Submission text can contain at most ${MAX_SUBMISSION_TEXT_LENGTH} characters`,
        },
      ],
      success: false,
    });
  });

  it("truncates oversized UTM metadata instead of rejecting values", () => {
    const parsed = submissionRequestSchema.parse({
      context: { utm: { utm_source: `  ${"x".repeat(250)}  ` } },
      values: {},
      versionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.context?.utm?.utm_source).toHaveLength(200);
  });

  it("rejects whitespace-only required text and omits absent optional values", () => {
    const company = schema.fields[1];
    if (!company) throw new Error("Expected the company field");
    const { visibility: _visibility, ...alwaysVisibleCompany } = company;
    const result = normalizeSubmission(
      {
        ...schema,
        fields: [
          alwaysVisibleCompany,
          {
            id: "55555555-5555-4555-8555-555555555555",
            key: "consent",
            label: "Consent",
            required: false,
            type: "checkbox",
            width: "full",
          },
        ],
      },
      { company: "   " },
    );

    expect(result).toEqual({
      errors: [{ field: "company", message: "This field is required" }],
      success: false,
    });
    expect(
      normalizeSubmission(
        {
          ...schema,
          fields: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              key: "consent",
              label: "Consent",
              required: false,
              type: "checkbox",
              width: "full",
            },
          ],
        },
        {},
      ),
    ).toEqual({ normalizedValues: {}, receivedValues: {}, success: true });
  });

  it("does not let a hidden stale value reveal a later field", () => {
    const contactReason = schema.fields[0];
    const company = schema.fields[1];
    if (!contactReason || !company) throw new Error("Expected schema fields");
    const chainedSchema: FormSchemaV1 = {
      ...schema,
      fields: [
        contactReason,
        company,
        {
          id: "55555555-5555-4555-8555-555555555555",
          key: "company_size",
          label: "Company size",
          required: true,
          type: "shortText",
          visibility: {
            fieldKey: "company",
            operator: "equals",
            value: "Form Forge",
          },
          width: "full",
        },
      ],
    };

    expect(
      normalizeSubmission(chainedSchema, {
        company: "Form Forge",
        company_size: "10",
        contact_reason: "support",
      }),
    ).toEqual({
      normalizedValues: { contact_reason: "support" },
      receivedValues: { contact_reason: "support" },
      success: true,
    });
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
