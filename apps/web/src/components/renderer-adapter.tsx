"use client";

import type {
  FieldShellProps,
  RendererComponents,
} from "@form-forge/form-renderer";
import { Alert, Button, Input, Select, Textarea } from "@form-forge/ui";
import type * as React from "react";

const FieldShell = ({ children, error, field }: FieldShellProps) => {
  const label = (
    <label className="text-sm font-medium text-slate-900" htmlFor={field.id}>
      {field.label}
      {field.required ? (
        <span aria-hidden="true" className="text-red-600">
          {" *"}
        </span>
      ) : null}
    </label>
  );

  return (
    <div className={field.width === "half" ? "sm:col-span-1" : "sm:col-span-2"}>
      {field.type === "checkbox" ? (
        <div className="flex items-center gap-2">
          {children}
          {label}
        </div>
      ) : (
        <>
          {label}
          <div className="mt-2">{children}</div>
        </>
      )}
      {field.description === undefined ? null : (
        <p
          id={`${field.id}-description`}
          className="mt-1 text-sm text-slate-500"
        >
          {field.description}
        </p>
      )}
      {error === undefined ? null : (
        <p
          id={`${field.id}-error`}
          role="alert"
          className="mt-1 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
};

const RendererInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <Input {...props} />
);
const RendererTextarea = (
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) => <Textarea {...props} />;
const RendererSelect = (
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) => <Select {...props} />;
const SubmitButton = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <Button {...props} />
);
const ErrorSummary = ({ errors }: { errors: string[] }) =>
  errors.length === 0 ? null : (
    <Alert className="mb-5">
      <p className="font-medium">Please correct the following:</p>
      <ul className="mt-1 list-disc pl-5">
        {errors.map((error, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Repeated error messages need distinct keys and these rows have no state.
          <li key={`${error}-${index}`}>{error}</li>
        ))}
      </ul>
    </Alert>
  );

export const webRendererComponents: RendererComponents = {
  ErrorSummary,
  FieldShell,
  Input: RendererInput,
  Select: RendererSelect,
  SubmitButton,
  Textarea: RendererTextarea,
};
