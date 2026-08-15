"use client";

import { FormRenderer } from "@form-forge/form-renderer";
import {
  FIELD_TYPES,
  formSchemaV1Schema,
  type FieldType,
  type FormField,
  type FormSchemaV1,
  type VisibilityOperator,
} from "@form-forge/form-schema";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  Textarea,
} from "@form-forge/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Plus,
  Save,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
} from "react-hook-form";

import { webRendererComponents } from "@/components/renderer-adapter";
import { ArchiveFormButton } from "./archive-form-button";

type ApiEnvelope<T> = { data?: T; error?: { message: string } };

const request = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? "The request failed");
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
  versions: Array<{ id: string; publishedAt: string; versionNumber: number }>;
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

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {schema.title}
            </h1>
            <Badge tone={published ? "success" : "neutral"}>
              {published ? "published" : "draft"}
            </Badge>
            {isDirty ? <Badge tone="warning">unsaved</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">/f/{publicSlug}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href={`/app/${workspaceSlug}/forms/${formId}/webhooks`}>
              <Webhook className="size-4" /> Webhooks
            </Link>
          </Button>
          {published ? (
            <Button asChild variant="secondary">
              <a href={`/f/${publicSlug}`} target="_blank" rel="noreferrer">
                <Eye className="size-4" /> Open form
              </a>
            </Button>
          ) : null}
          <Button
            disabled={
              !canEdit ||
              saveMutation.isPending ||
              publishMutation.isPending ||
              !isDirty
            }
            variant="secondary"
            onClick={() => void save()}
          >
            <Save className="size-4" />
            {saveMutation.isPending ? "Saving…" : "Save draft"}
          </Button>
          <Button
            disabled={
              !canEdit ||
              publishMutation.isPending ||
              saveMutation.isPending ||
              fields.length === 0
            }
            onClick={() => void publish()}
          >
            <Send className="size-4" />
            {publishMutation.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>

      {mutationError ? (
        <Alert className="mb-5">{mutationError.message}</Alert>
      ) : null}
      {notice ? (
        <Alert className="mb-5" tone="success">
          {notice}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="space-y-5">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="schema-title">Title</Label>
                <Input
                  id="schema-title"
                  disabled={!canEdit}
                  {...register("title")}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="schema-description">Description</Label>
                <Textarea
                  id="schema-description"
                  disabled={!canEdit}
                  {...register("description")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="submit-label">Submit button</Label>
                <Input
                  id="submit-label"
                  disabled={!canEdit}
                  {...register("settings.submitLabel")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="success-title">Success title</Label>
                <Input
                  id="success-title"
                  disabled={!canEdit}
                  {...register("settings.successTitle")}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="success-message">Success message</Label>
                <Textarea
                  id="success-message"
                  disabled={!canEdit}
                  {...register("settings.successMessage")}
                />
              </div>
            </CardContent>
          </Card>

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
                    {current.type === "shortText" ||
                    current.type === "longText" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor={`field-${index}-min-length`}>
                            Minimum length
                          </Label>
                          <Input
                            id={`field-${index}-min-length`}
                            disabled={!canEdit}
                            min={0}
                            type="number"
                            value={current.validation?.minLength ?? ""}
                            onChange={(event) => {
                              const { minLength: _minimum, ...rest } =
                                current.validation ?? {};
                              update(index, {
                                ...current,
                                validation: {
                                  ...rest,
                                  ...(event.target.value === ""
                                    ? {}
                                    : {
                                        minLength: Number(event.target.value),
                                      }),
                                },
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`field-${index}-max-length`}>
                            Maximum length
                          </Label>
                          <Input
                            id={`field-${index}-max-length`}
                            disabled={!canEdit}
                            min={1}
                            type="number"
                            value={current.validation?.maxLength ?? ""}
                            onChange={(event) => {
                              const { maxLength: _maximum, ...rest } =
                                current.validation ?? {};
                              update(index, {
                                ...current,
                                validation: {
                                  ...rest,
                                  ...(event.target.value === ""
                                    ? {}
                                    : {
                                        maxLength: Number(event.target.value),
                                      }),
                                },
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`field-${index}-pattern`}>
                            Pattern
                          </Label>
                          <Input
                            id={`field-${index}-pattern`}
                            disabled={!canEdit}
                            placeholder="^[A-Z].*$"
                            value={current.validation?.pattern ?? ""}
                            onChange={(event) => {
                              const { pattern: _pattern, ...rest } =
                                current.validation ?? {};
                              update(index, {
                                ...current,
                                validation: {
                                  ...rest,
                                  ...(event.target.value === ""
                                    ? {}
                                    : { pattern: event.target.value }),
                                },
                              });
                            }}
                          />
                        </div>
                      </>
                    ) : null}
                    {current.type === "number" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor={`field-${index}-min`}>Minimum</Label>
                          <Input
                            id={`field-${index}-min`}
                            disabled={!canEdit}
                            type="number"
                            value={current.validation?.min ?? ""}
                            onChange={(event) => {
                              const { min: _minimum, ...rest } =
                                current.validation ?? {};
                              update(index, {
                                ...current,
                                validation: {
                                  ...rest,
                                  ...(event.target.value === ""
                                    ? {}
                                    : { min: Number(event.target.value) }),
                                },
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`field-${index}-max`}>Maximum</Label>
                          <Input
                            id={`field-${index}-max`}
                            disabled={!canEdit}
                            type="number"
                            value={current.validation?.max ?? ""}
                            onChange={(event) => {
                              const { max: _maximum, ...rest } =
                                current.validation ?? {};
                              update(index, {
                                ...current,
                                validation: {
                                  ...rest,
                                  ...(event.target.value === ""
                                    ? {}
                                    : { max: Number(event.target.value) }),
                                },
                              });
                            }}
                          />
                        </div>
                      </>
                    ) : null}
                    {current.type === "date" ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor={`field-${index}-min-date`}>
                            Earliest date
                          </Label>
                          <Input
                            id={`field-${index}-min-date`}
                            disabled={!canEdit}
                            type="date"
                            value={current.validation?.min ?? ""}
                            onChange={(event) => {
                              const { min: _minimum, ...rest } =
                                current.validation ?? {};
                              update(index, {
                                ...current,
                                validation: {
                                  ...rest,
                                  ...(event.target.value === ""
                                    ? {}
                                    : { min: event.target.value }),
                                },
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`field-${index}-max-date`}>
                            Latest date
                          </Label>
                          <Input
                            id={`field-${index}-max-date`}
                            disabled={!canEdit}
                            type="date"
                            value={current.validation?.max ?? ""}
                            onChange={(event) => {
                              const { max: _maximum, ...rest } =
                                current.validation ?? {};
                              update(index, {
                                ...current,
                                validation: {
                                  ...rest,
                                  ...(event.target.value === ""
                                    ? {}
                                    : { max: event.target.value }),
                                },
                              });
                            }}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>

                  {earlierFields.length > 0 ? (
                    <fieldset className="rounded-lg border border-slate-200 p-4">
                      <legend className="px-1 text-sm font-medium">
                        Conditional visibility
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Select
                          aria-label="Visibility source field"
                          disabled={!canEdit}
                          value={current.visibility?.fieldKey ?? ""}
                          onChange={(event) => {
                            if (!event.target.value) {
                              const {
                                visibility: _visibility,
                                ...withoutVisibility
                              } = current;
                              update(index, withoutVisibility as FormField);
                              return;
                            }
                            update(index, {
                              ...current,
                              visibility: {
                                fieldKey: event.target.value,
                                operator: "equals",
                                value: "",
                              },
                            });
                          }}
                        >
                          <option value="">Always visible</option>
                          {earlierFields.map((candidate) => (
                            <option key={candidate.id} value={candidate.key}>
                              {candidate.label}
                            </option>
                          ))}
                        </Select>
                        {current.visibility === undefined ? null : (
                          <>
                            <Select
                              aria-label="Visibility operator"
                              disabled={!canEdit}
                              value={current.visibility.operator}
                              onChange={(event) => {
                                const operator = event.target
                                  .value as VisibilityOperator;
                                update(index, {
                                  ...current,
                                  visibility:
                                    operator === "isEmpty"
                                      ? {
                                          fieldKey:
                                            current.visibility?.fieldKey ?? "",
                                          operator,
                                        }
                                      : {
                                          fieldKey:
                                            current.visibility?.fieldKey ?? "",
                                          operator,
                                          value:
                                            current.visibility?.value ?? "",
                                        },
                                });
                              }}
                            >
                              <option value="equals">equals</option>
                              <option value="notEquals">does not equal</option>
                              <option value="contains">contains</option>
                              <option value="isEmpty">is empty</option>
                            </Select>
                            {current.visibility.operator ===
                            "isEmpty" ? null : (
                              <Input
                                aria-label="Visibility comparison value"
                                disabled={!canEdit}
                                value={String(current.visibility.value ?? "")}
                                onChange={(event) => {
                                  const visibility = current.visibility;
                                  if (!visibility) return;
                                  update(index, {
                                    ...current,
                                    visibility: {
                                      ...visibility,
                                      value: event.target.value,
                                    },
                                  });
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </fieldset>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="space-y-5">
            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold">Preview</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Uses the same renderer as the hosted form.
                </p>
              </div>
              <CardContent>
                {parsedSchema.success ? (
                  <div className="[&_form>button]:mt-6 [&_form>div]:grid [&_form>div]:gap-5 [&_form>div]:sm:grid-cols-2">
                    <h3 className="text-xl font-semibold">
                      {parsedSchema.data.title}
                    </h3>
                    {parsedSchema.data.description ? (
                      <p className="mt-2 mb-6 text-sm text-slate-600">
                        {parsedSchema.data.description}
                      </p>
                    ) : null}
                    <FormRenderer
                      components={webRendererComponents}
                      schema={parsedSchema.data}
                      onSubmit={() => undefined}
                    />
                  </div>
                ) : (
                  <Alert>
                    Preview is unavailable until the schema is valid.
                    <ul className="mt-2 list-disc pl-5">
                      {parsedSchema.error.issues.slice(0, 5).map((issue) => (
                        <li key={`${issue.path.join(".")}-${issue.message}`}>
                          {issue.path.join(".")}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                )}
              </CardContent>
            </Card>
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
            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold">Version history</h2>
              </div>
              <CardContent>
                {versions.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    No published versions yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {versions.map((version) => (
                      <li
                        key={version.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="font-medium">
                          Version {version.versionNumber}
                        </span>
                        <time className="text-slate-500">
                          {new Date(version.publishedAt).toLocaleDateString()}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
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
