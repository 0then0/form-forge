"use client";

import type { FormSchemaV1 } from "@form-forge/form-schema";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@form-forge/ui";
import { RotateCcw } from "lucide-react";
import { useState } from "react";

type Version = {
  id: string;
  publishedAt: string;
  schema: FormSchemaV1;
  versionNumber: number;
};

const compareSchemas = (version: FormSchemaV1, draft: FormSchemaV1) => {
  const oldFields = new Map(version.fields.map((field) => [field.key, field]));
  const draftFields = new Map(draft.fields.map((field) => [field.key, field]));
  const added = draft.fields.filter(
    (field) => !oldFields.has(field.key),
  ).length;
  const removed = version.fields.filter(
    (field) => !draftFields.has(field.key),
  ).length;
  const changed = draft.fields.filter((field) => {
    const previous = oldFields.get(field.key);
    return previous && JSON.stringify(previous) !== JSON.stringify(field);
  }).length;
  const formSettingsChanged =
    version.title !== draft.title ||
    version.description !== draft.description ||
    JSON.stringify(version.settings) !== JSON.stringify(draft.settings);
  const orderChanged =
    JSON.stringify(version.fields.map((field) => field.key)) !==
    JSON.stringify(draft.fields.map((field) => field.key));
  return { added, changed, formSettingsChanged, orderChanged, removed };
};

export const VersionHistory = ({
  canEdit,
  currentSchema,
  draftRevision,
  formId,
  onRestore,
  versions,
  workspaceSlug,
}: {
  canEdit: boolean;
  currentSchema: FormSchemaV1;
  draftRevision: string;
  formId: string;
  onRestore: (
    schema: FormSchemaV1,
    versionNumber: number,
    draftRevision: string,
  ) => void;
  versions: Version[];
  workspaceSlug: string;
}) => {
  const [error, setError] = useState<string>();
  const [restoringId, setRestoringId] = useState<string>();

  const restore = async (version: Version) => {
    if (
      !window.confirm(
        `Replace the current draft with version ${version.versionNumber}?`,
      )
    )
      return;
    setError(undefined);
    setRestoringId(version.id);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/versions/${version.id}/restore`,
        {
          body: JSON.stringify({ expectedRevision: draftRevision }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json()) as {
        data?: {
          draftRevision: string;
          draftSchema: FormSchemaV1;
          versionNumber: number;
        };
        error?: { message: string };
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Could not restore version");
      }
      onRestore(
        body.data.draftSchema,
        body.data.versionNumber,
        body.data.draftRevision,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not restore version",
      );
    } finally {
      setRestoringId(undefined);
    }
  };

  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-semibold">Version history</h2>
        <p className="mt-1 text-sm text-slate-600">
          Published versions are immutable. Restoring creates editable draft
          content.
        </p>
      </div>
      <CardContent>
        {error ? <Alert className="mb-3">{error}</Alert> : null}
        {versions.length === 0 ? (
          <p className="text-sm text-slate-600">No published versions yet.</p>
        ) : (
          <ol className="space-y-3">
            {versions.map((version) => {
              const diff = compareSchemas(version.schema, currentSchema);
              return (
                <li key={version.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        Version {version.versionNumber}
                      </div>
                      <time className="text-xs text-slate-500">
                        {new Date(version.publishedAt).toLocaleString()}
                      </time>
                    </div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          Inspect
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl">
                        <DialogTitle>
                          Version {version.versionNumber}
                        </DialogTitle>
                        <DialogDescription>
                          Compared with the current draft: {diff.added} added,{" "}
                          {diff.changed} changed, {diff.removed} removed fields.
                          {diff.orderChanged ? " Field order changed." : ""}
                          {diff.formSettingsChanged
                            ? " Form settings changed."
                            : ""}
                        </DialogDescription>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <section>
                            <h3 className="mb-2 text-sm font-medium">
                              Version {version.versionNumber}
                            </h3>
                            <pre className="max-h-[55vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
                              {JSON.stringify(version.schema, null, 2)}
                            </pre>
                          </section>
                          <section>
                            <h3 className="mb-2 text-sm font-medium">
                              Current draft
                            </h3>
                            <pre className="max-h-[55vh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
                              {JSON.stringify(currentSchema, null, 2)}
                            </pre>
                          </section>
                        </div>
                        <Button
                          className="mt-4"
                          disabled={!canEdit || restoringId !== undefined}
                          variant="secondary"
                          onClick={() => void restore(version)}
                        >
                          <RotateCcw className="size-4" />
                          {restoringId === version.id
                            ? "Restoring…"
                            : "Use as draft"}
                        </Button>
                      </DialogContent>
                    </Dialog>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
};
