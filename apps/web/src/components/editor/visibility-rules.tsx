"use client";

import type { FormField, VisibilityOperator } from "@form-forge/form-schema";
import { Input, Select } from "@form-forge/ui";

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
            update({
              ...field,
              visibility: {
                fieldKey: event.target.value,
                operator: "equals",
                value: "",
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
                          value: field.visibility?.value ?? "",
                        },
                });
              }}
            >
              <option value="equals">equals</option>
              <option value="notEquals">does not equal</option>
              <option value="contains">contains</option>
              <option value="isEmpty">is empty</option>
            </Select>
            {field.visibility.operator === "isEmpty" ? null : (
              <Input
                aria-label="Visibility comparison value"
                disabled={!canEdit}
                value={String(field.visibility.value ?? "")}
                onChange={(event) => {
                  const visibility = field.visibility;
                  if (!visibility) return;
                  update({
                    ...field,
                    visibility: { ...visibility, value: event.target.value },
                  });
                }}
              />
            )}
          </>
        )}
      </div>
    </fieldset>
  );
};
