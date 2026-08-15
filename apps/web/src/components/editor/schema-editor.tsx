"use client";

import {
  FIELD_TYPES,
  formSchemaV1Schema,
  type FieldType,
  type FormField,
  type FormSchemaV1,
} from "@form-forge/form-schema";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  Textarea,
} from "@form-forge/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
} from "react-hook-form";

import { ArchiveFormButton } from "./archive-form-button";
import { EditorHeader } from "./editor-header";
import { FieldValidation } from "./field-validation";
import { FormSettings } from "./form-settings";
import { SchemaPreview } from "./schema-preview";
import { useUnsavedChangesWarning } from "./use-unsaved-changes-warning";
import { VersionHistory } from "./version-history";
import { VisibilityRules } from "./visibility-rules";

type ApiEnvelope<T> = {
  data?: T;
  error?: { fieldErrors?: Record<string, string[]>; message: string };
};

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const request = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || body.data === undefined) {
    throw new ApiRequestError(
      body.error?.message ?? "The request failed",
      body.error?.fieldErrors,
    );
  }
  return body.data;
};

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
      return { ...base, type };
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

export const SchemaEditor = ({
  canEdit,
  formId,
  initialSchema,
  publicSlug,
  publicBaseUrl,
  published,
  versions,
  workspaceSlug,
}: {
  canEdit: boolean;
  formId: string;
  initialSchema: FormSchemaV1;
  publicSlug: string;
  publicBaseUrl: string;
  published: boolean;
  versions: Array<{
    id: string;
    publishedAt: string;
    schema: FormSchemaV1;
    versionNumber: number;
  }>;
  workspaceSlug: string;
}) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [notice, setNotice] = useState<string>();
  const form = useForm<FormSchemaV1>({ defaultValues: initialSchema });
  const {
    control,
    formState: { isDirty },
    handleSubmit,
    register,
    reset,
    setError,
  } = form;
  const { append, fields, move, remove, update } = useFieldArray({
    control,
    name: "fields",
    keyName: "editorKey",
  });
  const schema = useWatch({ control, compute: (value) => value });
  const parsedSchema = useMemo(
    () => formSchemaV1Schema.safeParse(schema),
    [schema],
  );

  useUnsavedChangesWarning(isDirty);

  const applyServerErrors = (error: Error) => {
    if (!(error instanceof ApiRequestError) || !error.fieldErrors) return;
    for (const [fieldPath, messages] of Object.entries(error.fieldErrors)) {
      if (fieldPath === "_root") continue;
      setError(path(fieldPath), {
        message: messages.join(". "),
        type: "server",
      });
    }
  };

  const saveMutation = useMutation({
    mutationFn: (nextSchema: FormSchemaV1) =>
      request<{ draftSchema: FormSchemaV1 }>(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/draft`,
        { body: JSON.stringify(nextSchema), method: "PUT" },
      ),
    onSuccess: (saved, submittedSchema) => {
      const changedDuringSave =
        JSON.stringify(form.getValues()) !== JSON.stringify(submittedSchema);
      reset(
        saved.draftSchema,
        changedDuringSave ? { keepValues: true } : undefined,
      );
      setNotice("Draft saved");
      void queryClient.invalidateQueries({
        queryKey: ["forms", workspaceSlug],
      });
    },
    onError: applyServerErrors,
  });
  const publishMutation = useMutation({
    mutationFn: async (nextSchema: FormSchemaV1) => {
      await request(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/draft`,
        { body: JSON.stringify(nextSchema), method: "PUT" },
      );
      return request<{ versionNumber: number }>(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/publish`,
        { method: "POST" },
      );
    },
    onSuccess: (version, publishedSchema) => {
      const changedDuringPublish =
        JSON.stringify(form.getValues()) !== JSON.stringify(publishedSchema);
      reset(
        publishedSchema,
        changedDuringPublish ? { keepValues: true } : undefined,
      );
      setNotice(`Version ${version.versionNumber} published`);
      void queryClient.invalidateQueries({
        queryKey: ["forms", workspaceSlug],
      });
      router.refresh();
    },
    onError: applyServerErrors,
  });

  const save = handleSubmit((value) => saveMutation.mutate(value));
  const publish = handleSubmit((value) => {
    if (
      window.confirm(
        "Publish this draft as a new immutable version? Existing submissions will keep their original version.",
      )
    ) {
      publishMutation.mutate(value);
    }
  });
  const mutationError = saveMutation.error ?? publishMutation.error;

  return (
    <div>
      <EditorHeader
        canPublish={
          canEdit &&
          !publishMutation.isPending &&
          !saveMutation.isPending &&
          fields.length > 0 &&
          parsedSchema.success
        }
        canSave={
          canEdit &&
          !saveMutation.isPending &&
          !publishMutation.isPending &&
          isDirty &&
          parsedSchema.success
        }
        dirty={isDirty}
        formId={formId}
        publicSlug={publicSlug}
        published={published}
        publishing={publishMutation.isPending}
        saving={saveMutation.isPending}
        title={schema.title}
        workspaceSlug={workspaceSlug}
        onPublish={() => void publish()}
        onSave={() => void save()}
      />

      {mutationError ? (
        <Alert className="mb-5">
          {mutationError.message}
          {mutationError instanceof ApiRequestError &&
          mutationError.fieldErrors ? (
            <ul className="mt-2 list-disc pl-5">
              {Object.entries(mutationError.fieldErrors).flatMap(
                ([fieldPath, messages]) =>
                  messages.map((message) => (
                    <li key={`${fieldPath}-${message}`}>
                      {fieldPath === "_root" ? "schema" : fieldPath}: {message}
                    </li>
                  )),
              )}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="mb-5" tone="success">
          {notice}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="space-y-5">
          <FormSettings canEdit={canEdit} register={register} />

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
            const current = schema.fields[index] ?? field;
            const earlierFields = schema.fields.slice(0, index);
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
                      <Label htmlFor={`field-${index}-webhook`}>
                        Webhook key
                      </Label>
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
                                const [label = "", value = label] =
                                  line.split("=");
                                return {
                                  label: label.trim(),
                                  value: value.trim(),
                                };
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
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="space-y-5">
            <SchemaPreview result={parsedSchema} />
            {published ? (
              <Card>
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="font-semibold">Embed</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Stable iframe using the hosted form.
                  </p>
                </div>
                <CardContent>
                  <code className="block overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs break-all whitespace-pre-wrap text-slate-100">
                    {`<iframe src="${publicBaseUrl}/f/${publicSlug}?embed=1" title="${schema.title}" loading="lazy" width="100%" height="640"></iframe>`}
                  </code>
                </CardContent>
              </Card>
            ) : null}
            <VersionHistory
              canEdit={canEdit}
              currentSchema={schema}
              formId={formId}
              versions={versions}
              workspaceSlug={workspaceSlug}
              onRestore={(restoredSchema, versionNumber) => {
                reset(restoredSchema);
                setNotice(`Version ${versionNumber} restored as draft`);
                router.refresh();
              }}
            />
            <Card>
              <CardContent>
                <h2 className="font-semibold">Danger zone</h2>
                <p className="mt-1 mb-4 text-sm text-slate-600">
                  Archiving disables the hosted form without deleting
                  submissions or versions.
                </p>
                <ArchiveFormButton
                  disabled={!canEdit}
                  formId={formId}
                  workspaceSlug={workspaceSlug}
                />
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
};
