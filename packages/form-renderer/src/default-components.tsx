import { isSafeHttpUrl } from "@form-forge/form-schema";
import type * as React from "react";

import type { RendererComponents } from "./types";

const FieldShell: RendererComponents["FieldShell"] = ({
  children,
  error,
  field,
}) => (
  <div>
    <label htmlFor={field.id}>
      {field.label}
      {field.required ? " *" : null}
    </label>
    {field.type === "checkbox" &&
    field.link &&
    isSafeHttpUrl(field.link.url) ? (
      <>
        {" "}
        <a
          id={`${field.id}-link`}
          href={field.link.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {field.link.label}
        </a>
      </>
    ) : null}
    {field.description === undefined ? null : (
      <p id={`${field.id}-description`}>{field.description}</p>
    )}
    {children}
    {error === undefined ? null : (
      <p id={`${field.id}-error`} role="alert">
        {error}
      </p>
    )}
  </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} />
);
const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} />
);
const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} />
);
const SubmitButton = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...props} />
);
const ErrorSummary = ({ errors }: { errors: string[] }) =>
  errors.length === 0 ? null : (
    <div role="alert">
      <p>Please correct the following errors:</p>
      <ul>
        {errors.map((error, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Repeated messages have no local state.
          <li key={`${error}-${index}`}>{error}</li>
        ))}
      </ul>
    </div>
  );

export const defaultRendererComponents: RendererComponents = {
  ErrorSummary,
  FieldShell,
  Input,
  Select,
  SubmitButton,
  Textarea,
};
