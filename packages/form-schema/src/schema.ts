import { z } from "zod";

import { patternLooksSafe } from "./safe-pattern";
import type { FormSchemaV1 } from "./types";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_FIELDS = 100;

const visibilityRuleSchema = z
  .object({
    fieldKey: z.string().regex(IDENTIFIER_PATTERN),
    operator: z.enum(["equals", "notEquals", "contains", "isEmpty"]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.operator !== "isEmpty" && rule.value === undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "A comparison value is required",
      });
    }
  });

const baseFieldShape = {
  id: z.uuid(),
  key: z.string().min(1).max(64).regex(IDENTIFIER_PATTERN),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  required: z.boolean(),
  width: z.enum(["full", "half"]),
  visibility: visibilityRuleSchema.optional(),
  webhookKey: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).max(64).regex(IDENTIFIER_PATTERN).optional(),
  ),
};

const textValidationSchema = z
  .object({
    minLength: z.number().int().min(0).max(10_000).optional(),
    maxLength: z.number().int().min(1).max(10_000).optional(),
    pattern: z.string().max(128).optional(),
  })
  .strict()
  .superRefine((validation, context) => {
    if (
      validation.minLength !== undefined &&
      validation.maxLength !== undefined &&
      validation.minLength > validation.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["minLength"],
        message: "Minimum length cannot exceed maximum length",
      });
    }

    if (validation.pattern !== undefined) {
      if (!patternLooksSafe(validation.pattern)) {
        context.addIssue({
          code: "custom",
          path: ["pattern"],
          message:
            "Pattern must use the safe anchored subset without groups, alternation, or multiple quantifiers",
        });
        return;
      }
      try {
        new RegExp(validation.pattern);
      } catch {
        context.addIssue({
          code: "custom",
          path: ["pattern"],
          message: "Pattern must be a valid regular expression",
        });
      }
    }
  });

const placeholderSchema = z.string().trim().max(160).optional();

const shortTextFieldSchema = z
  .object({
    ...baseFieldShape,
    type: z.literal("shortText"),
    placeholder: placeholderSchema,
    validation: textValidationSchema.optional(),
  })
  .strict();

const longTextFieldSchema = z
  .object({
    ...baseFieldShape,
    type: z.literal("longText"),
    placeholder: placeholderSchema,
    validation: textValidationSchema.optional(),
  })
  .strict();

const emailFieldSchema = z
  .object({
    ...baseFieldShape,
    type: z.literal("email"),
    placeholder: placeholderSchema,
  })
  .strict();

const numberFieldSchema = z
  .object({
    ...baseFieldShape,
    type: z.literal("number"),
    placeholder: placeholderSchema,
    validation: z
      .object({
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (
      field.validation?.min !== undefined &&
      field.validation.max !== undefined &&
      field.validation.min > field.validation.max
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation", "min"],
        message: "Minimum cannot exceed maximum",
      });
    }
  });

const selectFieldSchema = z
  .object({
    ...baseFieldShape,
    type: z.literal("select"),
    placeholder: placeholderSchema,
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            value: z.string().min(1).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((field, context) => {
    const values = field.options.map((option) => option.value);
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Option values must be unique",
      });
    }
  });

const checkboxFieldSchema = z
  .object({
    ...baseFieldShape,
    type: z.literal("checkbox"),
  })
  .strict();

const isoDateSchema = z.iso.date();
const dateFieldSchema = z
  .object({
    ...baseFieldShape,
    type: z.literal("date"),
    validation: z
      .object({
        min: isoDateSchema.optional(),
        max: isoDateSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (
      field.validation?.min !== undefined &&
      field.validation.max !== undefined &&
      field.validation.min > field.validation.max
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation", "min"],
        message: "Minimum date cannot exceed maximum date",
      });
    }
  });

export const formFieldSchema = z.discriminatedUnion("type", [
  shortTextFieldSchema,
  longTextFieldSchema,
  emailFieldSchema,
  numberFieldSchema,
  selectFieldSchema,
  checkboxFieldSchema,
  dateFieldSchema,
]);

export const formSchemaV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).optional(),
    fields: z.array(formFieldSchema).max(MAX_FIELDS),
    settings: z
      .object({
        submitLabel: z.string().trim().min(1).max(80),
        successTitle: z.string().trim().min(1).max(160),
        successMessage: z.string().trim().min(1).max(1_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((schema, context) => {
    const ids = schema.fields.map((field) => field.id);
    const keys = schema.fields.map((field) => field.key);
    const webhookKeys = schema.fields.map(
      (field) => field.webhookKey ?? field.key,
    );

    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Field identifiers must be unique",
      });
    }
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Field keys must be unique",
      });
    }
    if (new Set(webhookKeys).size !== webhookKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Webhook keys must be unique",
      });
    }

    const keyPositions = new Map(
      schema.fields.map((field, index) => [field.key, index]),
    );
    schema.fields.forEach((field, index) => {
      const dependency = field.visibility?.fieldKey;
      if (dependency === undefined) return;

      const dependencyIndex = keyPositions.get(dependency);
      if (dependencyIndex === undefined) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "visibility", "fieldKey"],
          message: "Visibility must reference an existing field",
        });
      } else if (dependencyIndex >= index) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "visibility", "fieldKey"],
          message: "Visibility can only reference an earlier field",
        });
      } else {
        const source = schema.fields[dependencyIndex];
        const rule = field.visibility;
        if (!source || !rule || rule.operator === "isEmpty") return;
        const expectedType =
          source.type === "number"
            ? "number"
            : source.type === "checkbox"
              ? "boolean"
              : "string";
        if (typeof rule.value !== expectedType) {
          context.addIssue({
            code: "custom",
            path: ["fields", index, "visibility", "value"],
            message: `Visibility value must be a ${expectedType}`,
          });
        }
        if (
          rule.operator === "contains" &&
          source.type !== "shortText" &&
          source.type !== "longText" &&
          source.type !== "email"
        ) {
          context.addIssue({
            code: "custom",
            path: ["fields", index, "visibility", "operator"],
            message: "Contains is only available for text fields",
          });
        }
      }
    });
  });

export const submissionContextSchema = z
  .object({
    utm: z
      .object({
        utm_source: z.string().trim().max(200).optional(),
        utm_medium: z.string().trim().max(200).optional(),
        utm_campaign: z.string().trim().max(200).optional(),
        utm_term: z.string().trim().max(200).optional(),
        utm_content: z.string().trim().max(200).optional(),
      })
      .strict()
      .optional(),
    visitorId: z.string().min(1).max(200).optional(),
    referrer: z.string().url().max(2_000).optional(),
  })
  .strict();

export const submissionRequestSchema = z
  .object({
    versionId: z.uuid(),
    values: z.record(z.string(), z.unknown()),
    context: submissionContextSchema.optional(),
  })
  .strict();

export const defaultFormSchema = (): FormSchemaV1 => ({
  schemaVersion: 1,
  title: "Untitled form",
  fields: [],
  settings: {
    submitLabel: "Submit",
    successTitle: "Thank you",
    successMessage: "Your response has been received.",
  },
});
