import { z } from "zod";

import { patternLooksSafe } from "./safe-pattern";
import { isFieldVisible } from "./visibility";
import type {
  FormField,
  FormSchemaV1,
  NormalizeSubmissionResult,
  NormalizedSubmissionValue,
  SubmissionFieldError,
} from "./types";

const emailSchema = z.email();
const dateSchema = z.iso.date();

const valueIsMissing = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === "" ||
  (typeof value === "number" && Number.isNaN(value));

const validateField = (
  field: FormField,
  value: unknown,
): NormalizedSubmissionValue | SubmissionFieldError => {
  if (valueIsMissing(value)) {
    if (field.required) {
      return { field: field.key, message: "This field is required" };
    }
    return "";
  }

  switch (field.type) {
    case "shortText":
    case "longText": {
      if (typeof value !== "string") {
        return { field: field.key, message: "Expected text" };
      }
      const normalized = value.trim();
      const minLength = field.validation?.minLength;
      const maxLength = field.validation?.maxLength;
      if (minLength !== undefined && normalized.length < minLength) {
        return {
          field: field.key,
          message: `Must contain at least ${minLength} characters`,
        };
      }
      if (maxLength !== undefined && normalized.length > maxLength) {
        return {
          field: field.key,
          message: `Must contain at most ${maxLength} characters`,
        };
      }
      if (
        field.validation?.pattern !== undefined &&
        (!patternLooksSafe(field.validation.pattern) ||
          !new RegExp(field.validation.pattern).test(normalized))
      ) {
        return { field: field.key, message: "Invalid format" };
      }
      return normalized;
    }
    case "email": {
      if (typeof value !== "string" || !emailSchema.safeParse(value).success) {
        return { field: field.key, message: "Enter a valid email address" };
      }
      return value.trim().toLowerCase();
    }
    case "number": {
      const normalized =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : Number.NaN;
      if (!Number.isFinite(normalized)) {
        return { field: field.key, message: "Enter a valid number" };
      }
      if (
        field.validation?.min !== undefined &&
        normalized < field.validation.min
      ) {
        return {
          field: field.key,
          message: `Must be at least ${field.validation.min}`,
        };
      }
      if (
        field.validation?.max !== undefined &&
        normalized > field.validation.max
      ) {
        return {
          field: field.key,
          message: `Must be at most ${field.validation.max}`,
        };
      }
      return normalized;
    }
    case "select": {
      if (
        typeof value !== "string" ||
        !field.options.some((option) => option.value === value)
      ) {
        return { field: field.key, message: "Select a valid option" };
      }
      return value;
    }
    case "checkbox": {
      if (typeof value !== "boolean") {
        return { field: field.key, message: "Expected a checkbox value" };
      }
      if (field.required && !value) {
        return { field: field.key, message: "This field must be checked" };
      }
      return value;
    }
    case "date": {
      if (typeof value !== "string" || !dateSchema.safeParse(value).success) {
        return { field: field.key, message: "Enter a valid date" };
      }
      if (field.validation?.min !== undefined && value < field.validation.min) {
        return {
          field: field.key,
          message: `Date must be on or after ${field.validation.min}`,
        };
      }
      if (field.validation?.max !== undefined && value > field.validation.max) {
        return {
          field: field.key,
          message: `Date must be on or before ${field.validation.max}`,
        };
      }
      return value;
    }
  }
};

export const normalizeSubmission = (
  schema: FormSchemaV1,
  values: Record<string, unknown>,
): NormalizeSubmissionResult => {
  const knownKeys = new Set(schema.fields.map((field) => field.key));
  const unknownKeys = Object.keys(values).filter((key) => !knownKeys.has(key));
  if (unknownKeys.length > 0) {
    return {
      success: false,
      errors: unknownKeys.map((field) => ({
        field,
        message: "Unknown field",
      })),
    };
  }

  const errors: SubmissionFieldError[] = [];
  const receivedValues: Record<string, NormalizedSubmissionValue> = {};
  const normalizedValues: Record<string, NormalizedSubmissionValue> = {};

  for (const field of schema.fields) {
    if (!isFieldVisible(field, values)) continue;

    const value = values[field.key];
    const validated = validateField(field, value);
    if (typeof validated === "object") {
      errors.push(validated);
      continue;
    }

    if (!valueIsMissing(value) || field.type === "checkbox") {
      receivedValues[field.key] = validated;
      normalizedValues[field.webhookKey ?? field.key] = validated;
    }
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, receivedValues, normalizedValues };
};
