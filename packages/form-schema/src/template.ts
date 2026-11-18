import { z } from "zod";

import { formSchemaV1Schema } from "./schema";
import type { FormSchemaV1 } from "./types";

// The template file format is versioned separately from `form.schemaVersion`:
// formatVersion describes the envelope, schemaVersion the form definition.
export const FORM_TEMPLATE_FORMAT = "form-forge.form-template";
export const FORM_TEMPLATE_VERSION = 1;

const SUPPORTED_FORMAT_VERSIONS: readonly unknown[] = [FORM_TEMPLATE_VERSION];
const SUPPORTED_SCHEMA_VERSIONS: readonly unknown[] = [1];

// Matches the draft request limit, so every saved draft can be imported again.
export const MAX_FORM_TEMPLATE_BYTES = 16_000_000;

export type FormTemplateV1 = {
  format: typeof FORM_TEMPLATE_FORMAT;
  formatVersion: typeof FORM_TEMPLATE_VERSION;
  form: FormSchemaV1;
};

const formTemplateV1Schema = z
  .object({
    format: z.literal(FORM_TEMPLATE_FORMAT),
    formatVersion: z.literal(FORM_TEMPLATE_VERSION),
    form: formSchemaV1Schema,
  })
  .strict();

export type FormTemplateIssue = { path: string; message: string };

export type ParseFormTemplateResult =
  | { success: true; template: FormTemplateV1 }
  | { success: false; message: string; issues: FormTemplateIssue[] };

// Only the form definition is exported: callers pass a draft schema, never a
// database row, so instance data cannot reach the file.
export const createFormTemplate = (form: FormSchemaV1): FormTemplateV1 => ({
  format: FORM_TEMPLATE_FORMAT,
  formatVersion: FORM_TEMPLATE_VERSION,
  form: formSchemaV1Schema.parse(form),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const describeVersion = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "missing or invalid";

const failure = (
  message: string,
  issues: FormTemplateIssue[] = [],
): ParseFormTemplateResult => ({ success: false, message, issues });

export const parseFormTemplate = (value: unknown): ParseFormTemplateResult => {
  if (!isRecord(value) || value.format !== FORM_TEMPLATE_FORMAT) {
    return failure("This file is not a Form Forge form template");
  }
  if (!SUPPORTED_FORMAT_VERSIONS.includes(value.formatVersion)) {
    return failure(
      `Template format version ${describeVersion(value.formatVersion)} is not supported. Supported versions: ${SUPPORTED_FORMAT_VERSIONS.join(", ")}.`,
    );
  }
  if (
    isRecord(value.form) &&
    !SUPPORTED_SCHEMA_VERSIONS.includes(value.form.schemaVersion)
  ) {
    return failure(
      `Form schema version ${describeVersion(value.form.schemaVersion)} is not supported. Supported versions: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.`,
    );
  }

  const parsed = formTemplateV1Schema.safeParse(value);
  if (!parsed.success) {
    return failure(
      "The template does not contain a valid form definition",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "_root",
        message: issue.message,
      })),
    );
  }
  return { success: true, template: parsed.data };
};
