import { formSchemaV1Schema, type FormSchemaV1 } from "@form-forge/form-schema";

export const normalizeSchemaForComparison = (schema: FormSchemaV1) => ({
  ...schema,
  description: schema.description || undefined,
  fields: schema.fields.map((field) => ({
    ...field,
    description: field.description || undefined,
    ...("placeholder" in field
      ? { placeholder: field.placeholder || undefined }
      : {}),
    webhookKey: field.webhookKey || undefined,
  })),
});

export const schemaFingerprint = (schema: unknown): string => {
  const parsed = formSchemaV1Schema.safeParse(schema);
  if (!parsed.success) return JSON.stringify(schema);

  return JSON.stringify(normalizeSchemaForComparison(parsed.data));
};
