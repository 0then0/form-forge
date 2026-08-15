"use client";

import {
  MAX_EMAIL_LENGTH,
  MAX_LONG_TEXT_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  isFieldVisible,
  normalizeSubmission,
  type FormField,
  type FormSchemaV1,
  type NormalizedSubmission,
} from "@form-forge/form-schema";
import { useMemo, useState } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";

import { defaultRendererComponents } from "./default-components";
import type { RendererComponents } from "./types";

type FormValues = Record<string, string | number | boolean>;

export type FormRendererProps = {
  schema: FormSchemaV1;
  onSubmit: (values: NormalizedSubmission) => Promise<void> | void;
  components?: Partial<RendererComponents>;
  disabled?: boolean;
};

const getFieldError = (
  errors: FieldErrors<FormValues>,
  key: string,
): string | undefined => {
  const message = errors[key]?.message;
  return typeof message === "string" ? message : undefined;
};

const getServerFieldErrors = (
  error: unknown,
): Record<string, string[]> | undefined => {
  if (typeof error !== "object" || error === null || !("fieldErrors" in error))
    return undefined;
  const fieldErrors = error.fieldErrors;
  if (typeof fieldErrors !== "object" || fieldErrors === null) return undefined;
  return Object.fromEntries(
    Object.entries(fieldErrors).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) &&
        entry[1].every((message) => typeof message === "string"),
    ),
  );
};

export const FormRenderer = ({
  components,
  disabled = false,
  onSubmit,
  schema,
}: FormRendererProps) => {
  const ui = useMemo(
    () => ({ ...defaultRendererComponents, ...components }),
    [components],
  );
  const [serverError, setServerError] = useState<string>();
  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<FormValues>({ defaultValues: {}, shouldUnregister: true });
  const watched = useWatch({ control });
  const watchedValues: Record<string, unknown> = { ...watched };

  const submit = handleSubmit(async (values) => {
    clearErrors();
    setServerError(undefined);
    const normalized = normalizeSubmission(schema, values);
    if (!normalized.success) {
      for (const error of normalized.errors) {
        setError(error.field, { message: error.message, type: "validate" });
      }
      return;
    }

    try {
      await onSubmit(normalized.receivedValues);
    } catch (error) {
      const fieldErrors = getServerFieldErrors(error);
      if (fieldErrors) {
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (
            field !== "_root" &&
            schema.fields.some(({ key }) => key === field)
          ) {
            setError(field, { message: messages.join(". "), type: "server" });
          }
        }
      }
      const rootError = fieldErrors?._root?.join(". ");
      if (rootError !== undefined) {
        setServerError(rootError);
      } else if (
        fieldErrors === undefined ||
        Object.keys(fieldErrors).length === 0
      ) {
        setServerError(
          error instanceof Error
            ? error.message
            : "The form could not be submitted. Please try again.",
        );
      }
    }
  });

  const errorMessages = Object.values(errors)
    .map((error) => error?.message)
    .filter((message): message is string => typeof message === "string");
  if (serverError !== undefined) errorMessages.unshift(serverError);

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <ui.ErrorSummary errors={errorMessages} />
      <div>
        {schema.fields.map((field) =>
          isFieldVisible(field, watchedValues) ? (
            <RenderedField
              key={field.id}
              components={ui}
              disabled={disabled || isSubmitting}
              error={getFieldError(errors, field.key)}
              field={field}
              register={register}
            />
          ) : null,
        )}
      </div>
      <ui.SubmitButton type="submit" disabled={disabled || isSubmitting}>
        {isSubmitting ? "Submitting…" : schema.settings.submitLabel}
      </ui.SubmitButton>
    </form>
  );
};

type RenderedFieldProps = {
  components: RendererComponents;
  disabled: boolean;
  error?: string | undefined;
  field: FormField;
  register: ReturnType<typeof useForm<FormValues>>["register"];
};

const RenderedField = ({
  components,
  disabled,
  error,
  field,
  register,
}: RenderedFieldProps) => {
  const describedBy = [
    field.description === undefined ? undefined : `${field.id}-description`,
    error === undefined ? undefined : `${field.id}-error`,
  ]
    .filter(Boolean)
    .join(" ");
  const common = {
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error === undefined ? undefined : true,
    "aria-required": field.required,
    disabled,
    id: field.id,
  };

  let control;
  switch (field.type) {
    case "longText":
      control = (
        <components.Textarea
          {...common}
          maxLength={Math.min(
            field.validation?.maxLength ?? MAX_LONG_TEXT_LENGTH,
            MAX_LONG_TEXT_LENGTH,
          )}
          placeholder={field.placeholder}
          {...register(field.key)}
        />
      );
      break;
    case "select":
      control = (
        <components.Select {...common} {...register(field.key)}>
          <option value="">{field.placeholder ?? "Select an option"}</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </components.Select>
      );
      break;
    case "checkbox":
      control = (
        <components.Input
          {...common}
          type="checkbox"
          {...register(field.key)}
        />
      );
      break;
    case "number":
      control = (
        <components.Input
          {...common}
          type="number"
          placeholder={field.placeholder}
          {...register(field.key, {
            setValueAs: (value: unknown) => (value === "" ? "" : Number(value)),
          })}
        />
      );
      break;
    case "date":
      control = (
        <components.Input
          {...common}
          type="date"
          min={field.validation?.min}
          max={field.validation?.max}
          {...register(field.key)}
        />
      );
      break;
    case "email":
      control = (
        <components.Input
          {...common}
          type="email"
          autoComplete="email"
          maxLength={MAX_EMAIL_LENGTH}
          placeholder={field.placeholder}
          {...register(field.key)}
        />
      );
      break;
    case "shortText":
      control = (
        <components.Input
          {...common}
          type="text"
          maxLength={Math.min(
            field.validation?.maxLength ?? MAX_SHORT_TEXT_LENGTH,
            MAX_SHORT_TEXT_LENGTH,
          )}
          placeholder={field.placeholder}
          {...register(field.key)}
        />
      );
      break;
  }

  return (
    <components.FieldShell field={field} error={error}>
      {control}
    </components.FieldShell>
  );
};
