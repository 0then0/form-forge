import type { FormField, FormSchemaV1 } from "@form-forge/form-schema";
import { Badge } from "@form-forge/ui";

import type { compareSchemas } from "./schema-comparison";

type Comparison = ReturnType<typeof compareSchemas>;
type Property = { label: string; value: string };

const fieldProperties = (field: FormField | undefined): Property[] => {
  if (!field) return [];
  return [
    { label: "Label", value: field.label },
    { label: "Key", value: field.key },
    { label: "Type", value: field.type },
    { label: "Required", value: field.required ? "Yes" : "No" },
    {
      label: "Link text",
      value: field.type === "checkbox" ? (field.link?.label ?? "") : "",
    },
    {
      label: "Link URL",
      value: field.type === "checkbox" ? (field.link?.url ?? "") : "",
    },
    { label: "Width", value: field.width === "half" ? "Half" : "Full" },
    { label: "Help text", value: field.description ?? "" },
    {
      label: "Placeholder",
      value: "placeholder" in field ? (field.placeholder ?? "") : "",
    },
    {
      label: "Webhook key",
      value: field.webhookKey || `Default (${field.key})`,
    },
    {
      label: "Options",
      value:
        field.type === "select"
          ? field.options
              .map((option) => `${option.label} (${option.value})`)
              .join("\n")
          : "",
    },
    {
      label: "Validation",
      value:
        "validation" in field && field.validation
          ? Object.entries(field.validation)
              .filter(([, value]) => value !== undefined)
              .map(
                ([key, value]) =>
                  `${({ min: "Minimum", max: "Maximum", minLength: "Minimum length", maxLength: "Maximum length", pattern: "Pattern" } as Record<string, string>)[key] ?? key}: ${value}`,
              )
              .join("\n")
          : "",
    },
    {
      label: "Visibility",
      value: field.visibility
        ? `${field.visibility.fieldKey} ${{ equals: "equals", notEquals: "does not equal", contains: "contains", isEmpty: "is empty" }[field.visibility.operator]}${field.visibility.value === undefined ? "" : ` ${field.visibility.value}`}`
        : "Always visible",
    },
  ];
};

const formProperties = (schema: FormSchemaV1): Property[] => [
  { label: "Title", value: schema.title },
  { label: "Description", value: schema.description ?? "" },
  { label: "Submit button", value: schema.settings.submitLabel },
  { label: "Success title", value: schema.settings.successTitle },
  { label: "Success message", value: schema.settings.successMessage },
];

const PropertyChanges = ({
  before,
  after,
  showAll = false,
  versionNumber,
}: {
  before: Property[];
  after: Property[];
  showAll?: boolean;
  versionNumber: number;
}) => {
  const labels = [...new Set([...before, ...after].map(({ label }) => label))];
  const rows = labels
    .map((label) => ({
      label,
      before: before.find((property) => property.label === label)?.value ?? "",
      after: after.find((property) => property.label === label)?.value ?? "",
    }))
    .filter(
      (row) =>
        (showAll || row.before !== row.after) && (row.before || row.after),
    );
  return (
    <dl className="divide-y divide-slate-100 dark:divide-slate-700">
      {rows.map((row) => (
        <div key={row.label} className="py-3 first:pt-0 last:pb-0">
          <dt className="mb-2 text-xs font-semibold text-slate-600">
            {row.label}
          </dt>
          <dd className="grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-md bg-slate-100 p-3">
              <p className="mb-1 text-xs text-slate-500">
                Version {versionNumber}
              </p>
              <p className="text-sm whitespace-pre-wrap text-slate-900 wrap-anywhere">
                {row.before || "Not set"}
              </p>
            </div>
            <div className="min-w-0 rounded-md bg-blue-50 p-3 dark:bg-blue-950">
              <p className="mb-1 text-xs text-slate-500">Current draft</p>
              <p className="text-sm whitespace-pre-wrap text-slate-900 wrap-anywhere">
                {row.after || "Not set"}
              </p>
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
};

export const VersionComparison = ({
  comparison,
  versionNumber,
}: {
  comparison: Comparison;
  versionNumber: number;
}) => {
  const {
    version,
    draft,
    added,
    changed,
    removed,
    orderChanged,
    formSettingsChanged,
  } = comparison;
  const previousFields = new Map(
    version.fields.map((field) => [field.id, field]),
  );
  const currentFields = new Map(draft.fields.map((field) => [field.id, field]));
  const fields = [
    ...draft.fields,
    ...version.fields.filter((field) => !currentFields.has(field.id)),
  ];
  const unchanged = fields.filter(
    (field) =>
      JSON.stringify(previousFields.get(field.id)) ===
      JSON.stringify(currentFields.get(field.id)),
  );
  const changedFields = fields.filter((field) => !unchanged.includes(field));
  return (
    <div className="space-y-5">
      {added + changed + removed === 0 &&
      !orderChanged &&
      !formSettingsChanged ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          This version matches the current draft.
        </p>
      ) : null}
      {formSettingsChanged ? (
        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-4 font-semibold">Form settings</h3>
          <PropertyChanges
            before={formProperties(version)}
            after={formProperties(draft)}
            versionNumber={versionNumber}
          />
        </section>
      ) : null}
      {orderChanged ? (
        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-4 font-semibold">Field order</h3>
          <PropertyChanges
            before={[
              {
                label: "Order",
                value: version.fields
                  .map((field, index) => `${index + 1}. ${field.label}`)
                  .join("\n"),
              },
            ]}
            after={[
              {
                label: "Order",
                value: draft.fields
                  .map((field, index) => `${index + 1}. ${field.label}`)
                  .join("\n"),
              },
            ]}
            versionNumber={versionNumber}
          />
        </section>
      ) : null}
      {changedFields.map((field) => {
        const before = previousFields.get(field.id);
        const after = currentFields.get(field.id);
        const status = !before ? "Added" : !after ? "Removed" : "Changed";
        return (
          <section
            key={field.id}
            className="rounded-lg border border-slate-200 p-4"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 font-semibold wrap-anywhere">
                {after?.label ?? before?.label}
              </h3>
              <Badge
                tone={
                  status === "Added"
                    ? "success"
                    : status === "Removed"
                      ? "danger"
                      : "info"
                }
              >
                {status}
              </Badge>
            </div>
            <PropertyChanges
              before={fieldProperties(before)}
              after={fieldProperties(after)}
              showAll={!before || !after}
              versionNumber={versionNumber}
            />
          </section>
        );
      })}
      {unchanged.length > 0 ? (
        <details className="rounded-lg border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Unchanged fields ({unchanged.length})
          </summary>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
            {unchanged.map((field) => (
              <li
                key={field.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="wrap-anywhere">{field.label}</span>
                <span className="text-xs text-slate-500">
                  {field.type}
                  {field.required ? " · Required" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <details className="rounded-lg border border-slate-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Schema JSON
        </summary>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          {[
            { label: `Version ${versionNumber}`, schema: version },
            { label: "Current draft", schema: draft },
          ].map(({ label, schema }) => (
            <section
              key={label}
              aria-label={`${label} schema JSON`}
              className="min-w-0"
            >
              <h3 className="mb-2 text-sm font-medium">{label}</h3>
              <pre className="rounded-md bg-slate-950 p-3 text-xs leading-5 whitespace-pre-wrap text-slate-100 wrap-anywhere">
                {JSON.stringify(schema, null, 2)}
              </pre>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
};
