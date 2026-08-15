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
    {field.description === undefined ? null : <p>{field.description}</p>}
    {children}
    {error === undefined ? null : <p role="alert">{error}</p>}
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
        {errors.map((error) => (
          <li key={error}>{error}</li>
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
