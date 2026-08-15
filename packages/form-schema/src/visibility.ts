import type { FormField, VisibilityRule } from "./types";

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === "" ||
  value === false ||
  (typeof value === "number" && Number.isNaN(value));

export const evaluateVisibilityRule = (
  rule: VisibilityRule,
  values: Record<string, unknown>,
): boolean => {
  const actual = values[rule.fieldKey];

  switch (rule.operator) {
    case "equals":
      return actual === rule.value;
    case "notEquals":
      return actual !== rule.value;
    case "contains":
      return (
        typeof actual === "string" &&
        typeof rule.value === "string" &&
        actual.includes(rule.value)
      );
    case "isEmpty":
      return isEmpty(actual);
  }
};

export const isFieldVisible = (
  field: FormField,
  values: Record<string, unknown>,
): boolean =>
  field.visibility === undefined ||
  evaluateVisibilityRule(field.visibility, values);
