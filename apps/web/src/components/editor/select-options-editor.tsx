"use client";

import type { FormSchemaV1 } from "@form-forge/form-schema";
import { Button, Input, Label } from "@form-forge/ui";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";

export const SelectOptionsEditor = ({
  canEdit,
  form,
  index,
}: {
  canEdit: boolean;
  form: UseFormReturn<FormSchemaV1>;
  index: number;
}) => {
  const name = `fields.${index}.options` as const;
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name,
  });
  const options = useWatch({ control: form.control, name }) ?? [];
  const errors = options.map((option) =>
    !option.label.trim() || !option.value.trim()
      ? "Enter a label and value for every option."
      : options.filter((item) => item.value === option.value).length > 1
        ? "Each option must have a unique value."
        : undefined,
  );
  return (
    <fieldset className="space-y-3 sm:col-span-2" disabled={!canEdit}>
      <legend className="text-sm font-medium">Options</legend>
      <p className="text-xs text-slate-500">
        Labels appear in the form. Values are saved in submissions and sent to
        webhooks.
      </p>
      {fields.map((option, optionIndex) => (
        <div key={option.id} className="space-y-1">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-32 flex-1 space-y-1">
              <Label htmlFor={`${name}-${optionIndex}-label`}>
                Option {optionIndex + 1} label
              </Label>
              <Input
                id={`${name}-${optionIndex}-label`}
                maxLength={120}
                aria-invalid={!!errors[optionIndex]}
                {...form.register(`${name}.${optionIndex}.label`)}
              />
            </div>
            <div className="min-w-32 flex-1 space-y-1">
              <Label htmlFor={`${name}-${optionIndex}-value`}>
                Option {optionIndex + 1} value
              </Label>
              <Input
                id={`${name}-${optionIndex}-value`}
                maxLength={120}
                aria-invalid={!!errors[optionIndex]}
                {...form.register(`${name}.${optionIndex}.value`)}
              />
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move option ${optionIndex + 1} up`}
              disabled={!canEdit || optionIndex === 0}
              onClick={() => move(optionIndex, optionIndex - 1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Move option ${optionIndex + 1} down`}
              disabled={!canEdit || optionIndex === fields.length - 1}
              onClick={() => move(optionIndex, optionIndex + 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove option ${optionIndex + 1}`}
              disabled={!canEdit}
              onClick={() => remove(optionIndex)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {errors[optionIndex] ? (
            <p role="alert" className="text-xs text-red-700">
              {errors[optionIndex]}
            </p>
          ) : null}
        </div>
      ))}
      {fields.length === 0 ? (
        <p role="alert" className="text-xs text-red-700">
          Add at least one option.
        </p>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={!canEdit || fields.length >= 100}
        onClick={() => {
          let next = fields.length + 1;
          while (options.some((option) => option.value === `option_${next}`))
            next++;
          append({ label: `Option ${next}`, value: `option_${next}` });
        }}
      >
        <Plus className="size-4" /> Add option
      </Button>
    </fieldset>
  );
};
