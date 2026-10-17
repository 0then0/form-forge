"use client";

import { isSafeHttpUrl } from "@form-forge/form-schema";
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
          <div className="text-sm">
            {label}
            {field.link && isSafeHttpUrl(field.link.url) ? (
              <>
                {" "}
                <a
                  id={`${field.id}-link`}
                  href={field.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 underline underline-offset-2"
                >
                  {field.link.label}
                </a>
              </>
            ) : null}
          </div>
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
    <Alert className="mb-5 space-y-2">
      <p className="font-medium">Please correct the following:</p>
      <ul className="list-disc space-y-1 pl-5 leading-6 wrap-break-word">
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
