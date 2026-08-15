import type { FormField } from "@form-forge/form-schema";
import type * as React from "react";

export type FieldShellProps = {
  field: FormField;
  error?: string | undefined;
  children: React.ReactNode;
};

export type RendererComponents = {
  FieldShell: React.ComponentType<FieldShellProps>;
  Input: React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
  Textarea: React.ComponentType<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >;
  Select: React.ComponentType<React.SelectHTMLAttributes<HTMLSelectElement>>;
  SubmitButton: React.ComponentType<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >;
  ErrorSummary: React.ComponentType<{ errors: string[] }>;
};
