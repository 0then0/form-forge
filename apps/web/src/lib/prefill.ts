import {
  MAX_FIELD_KEY_LENGTH,
  MAX_SELECT_OPTION_VALUE_LENGTH,
  getVisibleFields,
  type FormSchemaV1,
  type SelectField,
} from "@form-forge/form-schema";

const prefillParameter = "prefill";

export const getPrefillFields = (schema: FormSchemaV1): SelectField[] => {
  // The first render has no answers. Registered unchecked checkboxes contribute
  // false, so a prefilled field must also survive that visibility check.
  const unchecked = Object.fromEntries(
    schema.fields
      .filter((field) => field.type === "checkbox")
      .map((field) => [field.key, false]),
  );
  const visibleWithUnchecked = new Set(getVisibleFields(schema, unchecked));
  return getVisibleFields(schema, {}).filter(
    (field): field is SelectField =>
      field.type === "select" &&
      field.allowPrefill === true &&
      visibleWithUnchecked.has(field),
  );
};

export const resolvePrefill = (
  schema: FormSchemaV1,
  parameter: string | string[] | undefined,
) => {
  if (
    typeof parameter !== "string" ||
    parameter.length > MAX_FIELD_KEY_LENGTH + 1 + MAX_SELECT_OPTION_VALUE_LENGTH
  ) {
    return undefined;
  }

  // Field keys cannot contain a colon. Option values may contain more colons.
  const separator = parameter.indexOf(":");
  if (separator < 1 || separator > MAX_FIELD_KEY_LENGTH) return undefined;
  const fieldKey = parameter.slice(0, separator);
  const value = parameter.slice(separator + 1);
  if (!value || value.length > MAX_SELECT_OPTION_VALUE_LENGTH) return undefined;

  const field = getPrefillFields(schema).find(({ key }) => key === fieldKey);
  return field?.options.some((option) => option.value === value)
    ? { fieldKey, value }
    : undefined;
};

export const createPrefilledUrl = (
  publicUrl: string,
  fieldKey: string,
  value: string,
): string => {
  const url = new URL(publicUrl);
  url.searchParams.set(prefillParameter, `${fieldKey}:${value}`);
  return url.href;
};
