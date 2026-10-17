"use client";

import { FormRenderer } from "@form-forge/form-renderer";
import type { FormSchemaV1 } from "@form-forge/form-schema";
import { Alert, Badge, Card, CardContent } from "@form-forge/ui";
import Link from "next/link";

import { LocalDateTime } from "@/components/local-date-time";
import { webRendererComponents } from "@/components/renderer-adapter";
import { VersionHistory } from "./version-history";

type Version = {
  id: string;
  publishedAt: string;
  schema: FormSchemaV1;
  versionNumber: number;
};
const readOnlyComponents = {
  ...webRendererComponents,
  SubmitButton: () => null,
};

export const ArchivedFormView = ({
  schema,
  archivedAt,
  formId,
  draftRevision,
  versions,
  initialVersionCursor,
  workspaceSlug,
}: {
  schema: FormSchemaV1;
  archivedAt: string | null;
  formId: string;
  draftRevision: string;
  versions: Version[];
  initialVersionCursor: number | null;
  workspaceSlug: string;
}) => (
  <div>
    <Link
      href={`/app/${workspaceSlug}/forms?archived=1`}
      className="mb-4 inline-block text-sm text-slate-600 hover:underline"
    >
      ← Archived forms
    </Link>
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <h1 className="min-w-0 text-2xl font-semibold tracking-tight wrap-anywhere">
        {schema.title}
      </h1>
      <Badge>archived</Badge>
      {archivedAt ? (
        <p className="text-sm text-slate-500">
          Archived <LocalDateTime value={archivedAt} />
        </p>
      ) : null}
    </div>
    <Alert tone="info" className="mb-6">
      This form is archived. You can review its saved draft and published
      versions here. Restore it from the archive to make changes.
    </Alert>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <Card>
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Saved draft</h2>
        </div>
        <CardContent>
          {schema.description ? (
            <p className="mb-6 text-sm text-slate-600">{schema.description}</p>
          ) : null}
          <div className="[&_form>[data-form-fields]]:grid [&_form>[data-form-fields]]:gap-5 [&_form>[data-form-fields]]:sm:grid-cols-2">
            <FormRenderer
              schema={schema}
              disabled
              components={readOnlyComponents}
              onSubmit={() => undefined}
            />
          </div>
          <details className="mt-6 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              All fields ({schema.fields.length})
            </summary>
            <p className="mt-2 text-xs text-slate-500">
              Includes fields that are hidden by visibility rules.
            </p>
            <ol className="mt-3 space-y-2">
              {schema.fields.map((field) => (
                <li key={field.id} className="text-sm wrap-anywhere">
                  <span className="font-medium">{field.label}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {field.type} · {field.key}
                    {field.required ? " · Required" : ""}
                  </span>
                  {field.description ? (
                    <p className="text-slate-600">{field.description}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        </CardContent>
      </Card>
      <VersionHistory
        canEdit={false}
        currentSchema={schema}
        draftRevision={draftRevision}
        formId={formId}
        initialCursor={initialVersionCursor}
        versions={versions}
        workspaceSlug={workspaceSlug}
        onRestore={() => undefined}
      />
    </div>
  </div>
);
