import { formSchemaV1Schema, type FormSchemaV1 } from "@form-forge/form-schema";

const normalizeSchemaForComparison = (schema: FormSchemaV1) => ({
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

export const compareSchemas = (version: FormSchemaV1, draft: FormSchemaV1) => {
  const comparedVersion = normalizeSchemaForComparison(
    formSchemaV1Schema.parse(version),
  );
  const parsedDraft = formSchemaV1Schema.safeParse(draft);
  const comparedDraft = normalizeSchemaForComparison(
    parsedDraft.success ? parsedDraft.data : draft,
  );
  const oldFields = new Map(
    comparedVersion.fields.map((field) => [field.id, field]),
  );
  const draftFields = new Map(
    comparedDraft.fields.map((field) => [field.id, field]),
  );
  const added = comparedDraft.fields.filter(
    (field) => !oldFields.has(field.id),
  ).length;
  const removed = comparedVersion.fields.filter(
    (field) => !draftFields.has(field.id),
  ).length;
  const changed = comparedDraft.fields.filter((field) => {
    const previous = oldFields.get(field.id);
    return previous && JSON.stringify(previous) !== JSON.stringify(field);
  }).length;
  const formSettingsChanged =
    comparedVersion.title !== comparedDraft.title ||
    comparedVersion.description !== comparedDraft.description ||
    JSON.stringify(comparedVersion.settings) !==
      JSON.stringify(comparedDraft.settings);
  const orderChanged =
    JSON.stringify(
      comparedVersion.fields
        .filter((field) => draftFields.has(field.id))
        .map((field) => field.id),
    ) !==
    JSON.stringify(
      comparedDraft.fields
        .filter((field) => oldFields.has(field.id))
        .map((field) => field.id),
    );
  return {
    added,
    changed,
    formSettingsChanged,
    orderChanged,
    removed,
    version: comparedVersion,
    draft: comparedDraft,
  };
};
