"use client";

import type { FormField, VisibilityOperator } from "@form-forge/form-schema";
import { Input, Select } from "@form-forge/ui";

const defaultValue = (field: FormField): string | number | boolean => {
  if (field.type === "number") return 0;
  if (field.type === "checkbox") return true;
  return "";
};

const supportsContains = (field: FormField): boolean =>
  field.type === "shortText" ||
  field.type === "longText" ||
  field.type === "email";

export const VisibilityRules = ({
  canEdit,
  field,
  sourceFields,
  update,
}: {
  canEdit: boolean;
  field: FormField;
  sourceFields: FormField[];
  update: (field: FormField) => void;
}) => {
  if (sourceFields.length === 0) return null;
  const sourceField = sourceFields.find(
    (candidate) => candidate.key === field.visibility?.fieldKey,
  );

  const updateValue = (value: string | number | boolean | undefined) => {
    const visibility = field.visibility;
    if (!visibility) return;
    update({ ...field, visibility: { ...visibility, value } });
  };

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium">
        Conditional visibility
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          aria-label="Visibility source field"
          disabled={!canEdit}
          value={field.visibility?.fieldKey ?? ""}
          onChange={(event) => {
            if (!event.target.value) {
              const { visibility: _visibility, ...withoutVisibility } = field;
              update(withoutVisibility as FormField);
              return;
            }
            const selected = sourceFields.find(
              (candidate) => candidate.key === event.target.value,
            );
            if (!selected) return;
            update({
              ...field,
              visibility: {
                fieldKey: event.target.value,
                operator: "equals",
                value: defaultValue(selected),
              },
            });
          }}
        >
          <option value="">Always visible</option>
          {sourceFields.map((candidate) => (
            <option key={candidate.id} value={candidate.key}>
              {candidate.label}
            </option>
          ))}
        </Select>
        {field.visibility === undefined ? null : (
          <>
            <Select
              aria-label="Visibility operator"
              disabled={!canEdit}
              value={field.visibility.operator}
              onChange={(event) => {
                const operator = event.target.value as VisibilityOperator;
                update({
                  ...field,
                  visibility:
                    operator === "isEmpty"
                      ? {
                          fieldKey: field.visibility?.fieldKey ?? "",
                          operator,
                        }
                      : {
                          fieldKey: field.visibility?.fieldKey ?? "",
                          operator,
                          value:
                            field.visibility?.value ??
                            (sourceField ? defaultValue(sourceField) : ""),
                        },
                });
              }}
            >
              <option value="equals">equals</option>
              <option value="notEquals">does not equal</option>
              {sourceField && supportsContains(sourceField) ? (
                <option value="contains">contains</option>
              ) : null}
              <option value="isEmpty">is empty</option>
            </Select>
            {field.visibility.operator === "isEmpty" ? null : (
              <>
                {sourceField?.type === "checkbox" ? (
                  <Select
                    aria-label="Visibility comparison value"
                    disabled={!canEdit}
                    value={String(field.visibility.value ?? true)}
                    onChange={(event) =>
                      updateValue(event.target.value === "true")
                    }
                  >
                    <option value="true">checked</option>
                    <option value="false">not checked</option>
                  </Select>
                ) : sourceField?.type === "select" ? (
                  <Select
                    aria-label="Visibility comparison value"
                    disabled={!canEdit}
                    value={String(field.visibility.value ?? "")}
                    onChange={(event) => updateValue(event.target.value)}
                  >
                    {sourceField.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    aria-label="Visibility comparison value"
                    disabled={!canEdit}
                    type={
                      sourceField?.type === "number"
                        ? "number"
                        : sourceField?.type === "date"
                          ? "date"
                          : "text"
                    }
                    value={String(field.visibility.value ?? "")}
                    onChange={(event) =>
                      updateValue(
                        sourceField?.type === "number"
                          ? event.target.value === ""
                            ? undefined
                            : Number(event.target.value)
                          : event.target.value,
                      )
                    }
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </fieldset>
  );
};
