"use client";

import type { FormField } from "@form-forge/form-schema";
import { Input, Label } from "@form-forge/ui";

export const FieldValidation = ({
  canEdit,
  field,
  index,
  update,
}: {
  canEdit: boolean;
  field: FormField;
  index: number;
  update: (field: FormField) => void;
}) => {
  if (field.type === "shortText" || field.type === "longText") {
    return (
      <>
        <div className="space-y-2">
          <Label htmlFor={`field-${index}-min-length`}>Minimum length</Label>
          <Input
            id={`field-${index}-min-length`}
            disabled={!canEdit}
            min={0}
            type="number"
            value={field.validation?.minLength ?? ""}
            onChange={(event) => {
              const { minLength: _minimum, ...rest } = field.validation ?? {};
              update({
                ...field,
                validation: {
                  ...rest,
                  ...(event.target.value === ""
                    ? {}
                    : { minLength: Number(event.target.value) }),
                },
              });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`field-${index}-max-length`}>Maximum length</Label>
          <Input
            id={`field-${index}-max-length`}
            disabled={!canEdit}
            min={1}
            type="number"
            value={field.validation?.maxLength ?? ""}
            onChange={(event) => {
              const { maxLength: _maximum, ...rest } = field.validation ?? {};
              update({
                ...field,
                validation: {
                  ...rest,
                  ...(event.target.value === ""
                    ? {}
                    : { maxLength: Number(event.target.value) }),
                },
              });
            }}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`field-${index}-pattern`}>Pattern</Label>
          <Input
            id={`field-${index}-pattern`}
            disabled={!canEdit}
            placeholder="^[A-Z].*$"
            value={field.validation?.pattern ?? ""}
            onChange={(event) => {
              const { pattern: _pattern, ...rest } = field.validation ?? {};
              update({
                ...field,
                validation: {
                  ...rest,
                  ...(event.target.value === ""
                    ? {}
                    : { pattern: event.target.value }),
                },
              });
            }}
          />
        </div>
      </>
    );
  }

  if (field.type !== "number" && field.type !== "date") return null;
  const isNumber = field.type === "number";
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`field-${index}-minimum`}>
          {isNumber ? "Minimum" : "Earliest date"}
        </Label>
        <Input
          id={`field-${index}-minimum`}
          disabled={!canEdit}
          type={isNumber ? "number" : "date"}
          value={field.validation?.min ?? ""}
          onChange={(event) => {
            const { min: _minimum, ...rest } = field.validation ?? {};
            update({
              ...field,
              validation: {
                ...rest,
                ...(event.target.value === ""
                  ? {}
                  : {
                      min: isNumber
                        ? Number(event.target.value)
                        : event.target.value,
                    }),
              },
            } as FormField);
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`field-${index}-maximum`}>
          {isNumber ? "Maximum" : "Latest date"}
        </Label>
        <Input
          id={`field-${index}-maximum`}
          disabled={!canEdit}
          type={isNumber ? "number" : "date"}
          value={field.validation?.max ?? ""}
          onChange={(event) => {
            const { max: _maximum, ...rest } = field.validation ?? {};
            update({
              ...field,
              validation: {
                ...rest,
                ...(event.target.value === ""
                  ? {}
                  : {
                      max: isNumber
                        ? Number(event.target.value)
                        : event.target.value,
                    }),
              },
            } as FormField);
          }}
        />
      </div>
    </>
  );
};
