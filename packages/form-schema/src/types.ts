export const FIELD_TYPES = [
  "shortText",
  "longText",
  "email",
  "number",
  "select",
  "checkbox",
  "date",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type LayoutWidth = "full" | "half";

export type VisibilityOperator =
  "equals" | "notEquals" | "contains" | "isEmpty";

export type VisibilityRule = {
  fieldKey: string;
  operator: VisibilityOperator;
  value?: string | number | boolean | undefined;
};

type BaseField = {
  id: string;
  key: string;
  label: string;
  description?: string | undefined;
  required: boolean;
  width: LayoutWidth;
  visibility?: VisibilityRule | undefined;
  webhookKey?: string | undefined;
};

type TextValidation = {
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
};

export type ShortTextField = BaseField & {
  type: "shortText";
  placeholder?: string | undefined;
  validation?: TextValidation | undefined;
};

export type LongTextField = BaseField & {
  type: "longText";
  placeholder?: string | undefined;
  validation?: TextValidation | undefined;
};

export type EmailField = BaseField & {
  type: "email";
  placeholder?: string | undefined;
};

export type NumberField = BaseField & {
  type: "number";
  placeholder?: string | undefined;
  validation?:
    | {
        min?: number | undefined;
        max?: number | undefined;
      }
    | undefined;
};

export type SelectOption = {
  label: string;
  value: string;
};

export type SelectField = BaseField & {
  type: "select";
  placeholder?: string | undefined;
  options: SelectOption[];
};

export type CheckboxField = BaseField & {
  type: "checkbox";
};

export type DateField = BaseField & {
  type: "date";
  validation?:
    | {
        min?: string | undefined;
        max?: string | undefined;
      }
    | undefined;
};

export type FormField =
  | ShortTextField
  | LongTextField
  | EmailField
  | NumberField
  | SelectField
  | CheckboxField
  | DateField;

export type FormSchemaV1 = {
  schemaVersion: 1;
  title: string;
  description?: string | undefined;
  fields: FormField[];
  settings: {
    submitLabel: string;
    successTitle: string;
    successMessage: string;
  };
};

export type SubmissionContext = {
  utm?:
    | Partial<
        Record<
          | "utm_source"
          | "utm_medium"
          | "utm_campaign"
          | "utm_term"
          | "utm_content",
          string | undefined
        >
      >
    | undefined;
  visitorId?: string | undefined;
  referrer?: string | undefined;
};

export type SubmissionRequest = {
  versionId: string;
  values: Record<string, unknown>;
  context?: SubmissionContext | undefined;
};

export type NormalizedSubmissionValue = string | number | boolean;
export type NormalizedSubmission = Record<string, NormalizedSubmissionValue>;

export type SubmissionFieldError = {
  field: string;
  message: string;
};

export type NormalizeSubmissionResult =
  | {
      success: true;
      receivedValues: Record<string, NormalizedSubmissionValue>;
      normalizedValues: NormalizedSubmission;
    }
  | {
      success: false;
      errors: SubmissionFieldError[];
    };
