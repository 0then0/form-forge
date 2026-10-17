import type { ZodError } from "zod";

type Draft = { fields?: Array<{ label?: unknown }> };
const propertyNames: Record<string, string> = {
  title: "form title",
  description: "help text",
  label: "field label",
  key: "field key",
  webhookKey: "webhook key",
  placeholder: "placeholder",
  type: "field type",
  width: "field width",
  submitLabel: "submit button text",
  successTitle: "success title",
  successMessage: "success message",
  minLength: "minimum length",
  maxLength: "maximum length",
  min: "minimum value",
  max: "maximum value",
  pattern: "validation pattern",
  fieldKey: "visibility source",
  value: "comparison value",
  operator: "visibility condition",
};

export const formatSchemaIssues = (
  error: ZodError,
  draft?: unknown,
): string[] => {
  const fields =
    typeof draft === "object" && draft !== null
      ? (draft as Draft).fields
      : undefined;
  return [
    ...new Set(
      error.issues.map((issue) => {
        const path = issue.path;
        const index =
          path[0] === "fields" && typeof path[1] === "number"
            ? path[1]
            : undefined;
        const label = index === undefined ? undefined : fields?.[index]?.label;
        const prefix =
          index === undefined
            ? ""
            : `Field ${index + 1}${typeof label === "string" && label.trim() ? ` “${label.trim()}”` : ""}: `;
        const property = String(path.at(-1) ?? "");
        const isOption = path.includes("options");
        const optionIndex =
          isOption && typeof path[3] === "number" ? path[3] + 1 : undefined;
        const isLink = path.includes("link");
        const name = isLink
          ? property === "url"
            ? "link URL"
            : "link text"
          : isOption && optionIndex !== undefined
            ? `${property === "label" ? "label" : "value"} for option ${optionIndex}`
            : (propertyNames[property] ?? "form setting");
        let message: string;
        if (isLink && property === "url")
          message =
            "Enter a full http:// or https:// link without a username or password.";
        else if (issue.code === "too_small") {
          message =
            issue.origin === "string"
              ? issue.minimum === 1
                ? `Enter the ${name}.`
                : `The ${name} must contain at least ${issue.minimum} characters.`
              : isOption
                ? "Add at least one option."
                : `The ${name} must be at least ${issue.minimum}.`;
        } else if (issue.code === "too_big") {
          message =
            issue.origin === "string"
              ? `Use at most ${issue.maximum} characters for the ${name}.`
              : property === "fields"
                ? `A form can have at most ${issue.maximum} fields.`
                : property === "options"
                  ? `Use at most ${issue.maximum} options.`
                  : `The ${name} must be at most ${issue.maximum}.`;
        } else if (property === "key" || property === "webhookKey") {
          message = `Use a ${name} starting with a lowercase letter, with only lowercase letters, numbers and underscores.`;
        } else if (issue.code === "custom")
          message = `${issue.message.replace(/\.$/, "")}.`;
        else if (issue.code === "invalid_type")
          message =
            issue.expected === "number"
              ? `Enter a valid number for the ${name}.`
              : `Check the ${name}.`;
        else if (
          issue.code === "invalid_format" &&
          ["min", "max"].includes(property)
        )
          message = "Enter a valid date in YYYY-MM-DD format.";
        else if (property === "type" || issue.code === "invalid_union")
          message = "Choose a supported field type.";
        else message = `Check the ${name} and try again.`;
        return prefix + message;
      }),
    ),
  ];
};
