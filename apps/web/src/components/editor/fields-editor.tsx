"use client";

import {
  FIELD_TYPES,
  type FieldType,
  type FormField,
  type FormSchemaV1,
} from "@form-forge/form-schema";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  Textarea,
} from "@form-forge/ui";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type FieldPath,
  type UseFormReturn,
} from "react-hook-form";

import { FieldValidation } from "./field-validation";
import { VisibilityRules } from "./visibility-rules";

const makeField = (type: FieldType, existing?: FormField): FormField => {
  const base = {
    id: existing?.id ?? crypto.randomUUID(),
    key: existing?.key ?? `field_${crypto.randomUUID().slice(0, 6)}`,
    label: existing?.label ?? "New field",
    required: existing?.required ?? false,
    width: existing?.width ?? ("full" as const),
    ...(existing?.description === undefined
      ? {}
      : { description: existing.description }),
    ...(existing?.visibility === undefined
      ? {}
      : { visibility: existing.visibility }),
    ...(existing?.webhookKey === undefined
      ? {}
      : { webhookKey: existing.webhookKey }),
  };

  switch (type) {
    case "select":
      return {
        ...base,
        type,
        options: [{ label: "Option 1", value: "option_1" }],
      };
    case "checkbox":
    case "date":
      return { ...base, type };
    case "number":
      return { ...base, type, placeholder: "" };
    case "email":
      return { ...base, type, placeholder: "name@example.com" };
    case "longText":
    case "shortText":
      return { ...base, type, placeholder: "" };
  }
};

const path = (value: string) => value as FieldPath<FormSchemaV1>;

export const FieldsEditor = ({
  canEdit,
  form,
}: {
  canEdit: boolean;
  form: UseFormReturn<FormSchemaV1>;
}) => {
  const { control, register } = form;
  const { append, fields, move, remove, update } = useFieldArray({
    control,
    name: "fields",
    keyName: "editorKey",
  });
  const currentFields = useWatch({ control, name: "fields" });

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Fields</h2>
          <p className="text-sm text-slate-600">
            Order fields with explicit controls.
          </p>
        </div>
        <Button
          disabled={!canEdit}
          size="sm"
          variant="secondary"
          onClick={() => append(makeField("shortText"))}
        >
          <Plus className="size-4" /> Add field
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          Add the first field to make this draft publishable.
        </div>
      ) : null}

      {fields.map((field, index) => {
        const current = currentFields[index] ?? field;
        const earlierFields = currentFields.slice(0, index);
        return (
          <Card key={field.editorKey}>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded bg-slate-100 text-xs font-medium">
                  {index + 1}
                </span>
                <div className="ml-auto flex gap-1">
                  <Button
                    aria-label="Move field up"
                    disabled={!canEdit || index === 0}
                    size="icon"
                    variant="ghost"
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    aria-label="Move field down"
                    disabled={!canEdit || index === fields.length - 1}
                    size="icon"
                    variant="ghost"
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    aria-label="Remove field"
                    disabled={!canEdit}
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="size-4 text-red-600" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`field-${index}-type`}>Type</Label>
                  <Select
                    id={`field-${index}-type`}
                    disabled={!canEdit}
                    value={current.type}
                    onChange={(event) =>
                      update(
                        index,
                        makeField(event.target.value as FieldType, current),
                      )
                    }
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`field-${index}-label`}>Label</Label>
                  <Input
                    id={`field-${index}-label`}
                    disabled={!canEdit}
                    {...register(path(`fields.${index}.label`))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`field-${index}-key`}>Key</Label>
                  <Input
                    id={`field-${index}-key`}
                    disabled={!canEdit}
                    {...register(path(`fields.${index}.key`))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`field-${index}-webhook`}>Webhook key</Label>
                  <Input
                    id={`field-${index}-webhook`}
                    disabled={!canEdit}
                    placeholder={current.key}
                    {...register(path(`fields.${index}.webhookKey`))}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`field-${index}-description`}>
                    Help text
                  </Label>
                  <Input
                    id={`field-${index}-description`}
                    disabled={!canEdit}
                    {...register(path(`fields.${index}.description`))}
                  />
                </div>
                {"placeholder" in current ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor={`field-${index}-placeholder`}>
                      Placeholder
                    </Label>
                    <Input
                      id={`field-${index}-placeholder`}
                      disabled={!canEdit}
                      {...register(path(`fields.${index}.placeholder`))}
                    />
                  </div>
                ) : null}
                {current.type === "select" ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor={`field-${index}-options`}>
                      Options, one per line as label=value
                    </Label>
                    <Textarea
                      id={`field-${index}-options`}
                      disabled={!canEdit}
                      value={current.options
                        .map((option) => `${option.label}=${option.value}`)
                        .join("\n")}
                      onChange={(event) => {
                        const options = event.target.value
                          .split("\n")
                          .filter(Boolean)
                          .map((line) => {
                            const [label = "", value = label] = line.split("=");
                            return { label: label.trim(), value: value.trim() };
                          });
                        update(index, { ...current, options });
                      }}
                    />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor={`field-${index}-width`}>Width</Label>
                  <Select
                    id={`field-${index}-width`}
                    disabled={!canEdit}
                    {...register(path(`fields.${index}.width`))}
                  >
                    <option value="full">Full</option>
                    <option value="half">Half</option>
                  </Select>
                </div>
                <label className="flex items-center gap-2 self-end py-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    {...register(path(`fields.${index}.required`))}
                  />
                  Required
                </label>
                <FieldValidation
                  canEdit={canEdit}
                  field={current}
                  index={index}
                  update={(nextField) => update(index, nextField)}
                />
              </div>

              <VisibilityRules
                canEdit={canEdit}
                field={current}
                sourceFields={earlierFields}
                update={(nextField) => update(index, nextField)}
              />
            </CardContent>
          </Card>
        );
      })}
    </>
  );
};
