"use client";

import { formSchemaV1Schema, type FormSchemaV1 } from "@form-forge/form-schema";
import { Alert, Card, CardContent } from "@form-forge/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  useForm,
  useWatch,
  type FieldPath,
  type UseFormReturn,
} from "react-hook-form";

import { ClientApiError, readApiData } from "@/lib/client-api";
import { ArchiveFormButton } from "./archive-form-button";
import { EditorHeader } from "./editor-header";
import { FieldsEditor } from "./fields-editor";
import { FormSettings } from "./form-settings";
import { PreviewErrorBoundary } from "./preview-error-boundary";
import { SchemaPreview } from "./schema-preview";
import { useUnsavedChangesWarning } from "./use-unsaved-changes-warning";
import { VersionHistory } from "./version-history";
import { schemaFingerprint } from "./schema-comparison";

type Version = {
  id: string;
  publishedAt: string;
  schema: FormSchemaV1;
  versionNumber: number;
};

type EditorStatus = {
  changedSincePublish: boolean;
  fieldCount: number;
  valid: boolean;
};

const request = async <T,>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  return readApiData<T>(response, "The request failed");
};

const summarizeSchema = (
  schema: FormSchemaV1,
  lastPublishedSchema?: FormSchemaV1,
): EditorStatus => ({
  changedSincePublish:
    lastPublishedSchema === undefined ||
    schemaFingerprint(schema) !== schemaFingerprint(lastPublishedSchema),
  fieldCount: schema.fields.length,
  valid: formSchemaV1Schema.safeParse(schema).success,
});

const path = (value: string) => value as FieldPath<FormSchemaV1>;

const escapeHtmlAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const SchemaEditor = ({
  canEdit,
  formId,
  initialDraftRevision,
  initialVersionCursor = null,
  initialSchema,
  publicSlug,
  publicBaseUrl,
  published,
  versions,
  workspaceSlug,
}: {
  canEdit: boolean;
  formId: string;
  initialDraftRevision: string;
  initialVersionCursor?: number | null;
  initialSchema: FormSchemaV1;
  publicSlug: string;
  publicBaseUrl: string;
  published: boolean;
  versions: Version[];
  workspaceSlug: string;
}) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [draftRevision, setDraftRevision] = useState(initialDraftRevision);
  const lastPublishedSchema = useRef(versions[0]?.schema);
  const [lastSavedSchemaFingerprint, setLastSavedSchemaFingerprint] = useState(
    () => schemaFingerprint(initialSchema),
  );
  const [editorStatus, setEditorStatus] = useState(() =>
    summarizeSchema(initialSchema, versions[0]?.schema),
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [restoring, setRestoring] = useState(false);
  const form = useForm<FormSchemaV1>({ defaultValues: initialSchema });
  const { handleSubmit, register, reset, setError } = form;

  useEffect(
    () =>
      form.subscribe({
        callback: ({ values }) => {
          setNotice(undefined);
          const next = summarizeSchema(values, lastPublishedSchema.current);
          setHasUnsavedChanges(
            schemaFingerprint(values) !== lastSavedSchemaFingerprint,
          );
          setEditorStatus((current) =>
            current.changedSincePublish === next.changedSincePublish &&
            current.fieldCount === next.fieldCount &&
            current.valid === next.valid
              ? current
              : next,
          );
        },
        formState: { values: true },
      }),
    [form, lastSavedSchemaFingerprint],
  );

  useUnsavedChangesWarning(hasUnsavedChanges);

  const applyServerErrors = (error: Error) => {
    if (!(error instanceof ClientApiError) || !error.fieldErrors) return;
    for (const [fieldPath, messages] of Object.entries(error.fieldErrors)) {
      if (fieldPath === "_root" || fieldPath === "schema") continue;
      const editorPath = fieldPath.startsWith("schema.")
        ? fieldPath.slice("schema.".length)
        : fieldPath;
      setError(path(editorPath), {
        message: messages.join(". "),
        type: "server",
      });
    }
  };

  const saveMutation = useMutation({
    mutationFn: (nextSchema: FormSchemaV1) =>
      request<{ draftSchema: FormSchemaV1; updatedAt: string }>(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/draft`,
        {
          body: JSON.stringify({
            expectedRevision: draftRevision,
            schema: nextSchema,
          }),
          method: "PUT",
        },
      ),
    onSuccess: (saved, submittedSchema) => {
      setDraftRevision(saved.updatedAt);
      const changedDuringSave =
        JSON.stringify(form.getValues()) !== JSON.stringify(submittedSchema);
      setLastSavedSchemaFingerprint(schemaFingerprint(saved.draftSchema));
      reset(
        saved.draftSchema,
        changedDuringSave ? { keepValues: true } : undefined,
      );
      setHasUnsavedChanges(
        schemaFingerprint(form.getValues()) !==
          schemaFingerprint(saved.draftSchema),
      );
      setNotice("Draft saved");
      void queryClient.invalidateQueries({
        queryKey: ["forms", workspaceSlug],
      });
    },
    onError: applyServerErrors,
  });
  const publishMutation = useMutation({
    mutationFn: (nextSchema: FormSchemaV1) =>
      request<{ draftRevision: string; versionNumber: number }>(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/publish`,
        {
          body: JSON.stringify({
            expectedRevision: draftRevision,
            schema: nextSchema,
          }),
          method: "POST",
        },
      ),
    onSuccess: (version, publishedSchema) => {
      setDraftRevision(version.draftRevision);
      lastPublishedSchema.current = publishedSchema;
      setEditorStatus(summarizeSchema(form.getValues(), publishedSchema));
      const changedDuringPublish =
        JSON.stringify(form.getValues()) !== JSON.stringify(publishedSchema);
      setLastSavedSchemaFingerprint(schemaFingerprint(publishedSchema));
      reset(
        publishedSchema,
        changedDuringPublish ? { keepValues: true } : undefined,
      );
      setHasUnsavedChanges(
        schemaFingerprint(form.getValues()) !==
          schemaFingerprint(publishedSchema),
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
      <EditorHeaderWithTitle
        canPublish={
          canEdit &&
          !restoring &&
          !publishMutation.isPending &&
          !saveMutation.isPending &&
          editorStatus.fieldCount > 0 &&
          editorStatus.valid &&
          editorStatus.changedSincePublish
        }
        canSave={
          canEdit &&
          !restoring &&
          !saveMutation.isPending &&
          !publishMutation.isPending &&
          hasUnsavedChanges &&
          editorStatus.valid
        }
        dirty={hasUnsavedChanges}
        form={form}
        formId={formId}
        publicSlug={publicSlug}
        published={published}
        publishing={publishMutation.isPending}
        saving={saveMutation.isPending}
        workspaceSlug={workspaceSlug}
        onPublish={() => void publish()}
        onSave={() => void save()}
      />

      {mutationError ? (
        <Alert className="mb-5">
          {mutationError.message}
          {mutationError instanceof ClientApiError &&
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
          <FormSettings canEdit={canEdit && !restoring} register={register} />
          <FieldsEditor canEdit={canEdit && !restoring} form={form} />
        </div>

        <EditorSidebar
          canEdit={
            canEdit && !saveMutation.isPending && !publishMutation.isPending
          }
          onRestoringChange={setRestoring}
          restoring={restoring}
          draftRevision={draftRevision}
          form={form}
          formId={formId}
          publicBaseUrl={publicBaseUrl}
          publicSlug={publicSlug}
          published={published}
          versions={versions}
          initialVersionCursor={initialVersionCursor}
          workspaceSlug={workspaceSlug}
          onRestore={(restoredSchema, versionNumber, restoredRevision) => {
            setDraftRevision(restoredRevision);
            setLastSavedSchemaFingerprint(schemaFingerprint(restoredSchema));
            reset(restoredSchema);
            setHasUnsavedChanges(false);
            setNotice(`Version ${versionNumber} restored as draft`);
            router.refresh();
          }}
        />
      </div>
    </div>
  );
};

const EditorHeaderWithTitle = ({
  form,
  ...props
}: Omit<Parameters<typeof EditorHeader>[0], "title"> & {
  form: UseFormReturn<FormSchemaV1>;
}) => {
  const title = useWatch({ control: form.control, name: "title" });
  return <EditorHeader {...props} title={title} />;
};

const EditorSidebar = ({
  canEdit,
  draftRevision,
  form,
  formId,
  initialVersionCursor,
  onRestore,
  onRestoringChange,
  restoring,
  publicBaseUrl,
  publicSlug,
  published,
  versions,
  workspaceSlug,
}: {
  canEdit: boolean;
  draftRevision: string;
  form: UseFormReturn<FormSchemaV1>;
  formId: string;
  initialVersionCursor: number | null;
  onRestore: (
    schema: FormSchemaV1,
    versionNumber: number,
    draftRevision: string,
  ) => void;
  onRestoringChange: (restoring: boolean) => void;
  restoring: boolean;
  publicBaseUrl: string;
  publicSlug: string;
  published: boolean;
  versions: Version[];
  workspaceSlug: string;
}) => {
  const schema = useWatch({
    control: form.control,
    compute: (value) => value,
  });
  const deferredSchema = useDeferredValue(schema);
  const parsedSchema = formSchemaV1Schema.safeParse(deferredSchema);
  const serializedSchema = JSON.stringify(deferredSchema);

  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <div className="space-y-5">
        <PreviewErrorBoundary resetKey={serializedSchema}>
          <SchemaPreview result={parsedSchema} />
        </PreviewErrorBoundary>
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
                {`<iframe src="${publicBaseUrl}/f/${publicSlug}?embed=1" title="${escapeHtmlAttribute(deferredSchema.title)}" loading="lazy" width="100%" height="640"></iframe>`}
              </code>
            </CardContent>
          </Card>
        ) : null}
        <VersionHistory
          key={versions[0]?.id ?? "no-versions"}
          canEdit={canEdit}
          currentSchema={deferredSchema}
          draftRevision={draftRevision}
          formId={formId}
          versions={versions}
          initialCursor={initialVersionCursor}
          workspaceSlug={workspaceSlug}
          onRestore={onRestore}
          onRestoringChange={onRestoringChange}
        />
        <Card>
          <CardContent>
            <h2 className="font-semibold">Danger zone</h2>
            <p className="mt-1 mb-4 text-sm text-slate-600">
              Archiving disables the hosted form without deleting submissions or
              versions.
            </p>
            <ArchiveFormButton
              disabled={!canEdit || restoring}
              formId={formId}
              workspaceSlug={workspaceSlug}
            />
          </CardContent>
        </Card>
      </div>
    </aside>
  );
};
