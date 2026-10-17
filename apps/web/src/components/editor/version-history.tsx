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

import { readApiData } from "@/lib/client-api";
import { LocalDateTime } from "@/components/local-date-time";
import { compareSchemas } from "./schema-comparison";
import { VersionComparison } from "./version-comparison";

type Version = {
  id: string;
  publishedAt: string;
  schema: FormSchemaV1;
  versionNumber: number;
};

export const VersionHistory = ({
  canEdit,
  currentSchema,
  draftRevision,
  formId,
  initialCursor,
  onRestore,
  onRestoringChange,
  versions,
  workspaceSlug,
}: {
  canEdit: boolean;
  currentSchema: FormSchemaV1;
  draftRevision: string;
  formId: string;
  initialCursor: number | null;
  onRestore: (
    schema: FormSchemaV1,
    versionNumber: number,
    draftRevision: string,
  ) => void;
  onRestoringChange?: (restoring: boolean) => void;
  versions: Version[];
  workspaceSlug: string;
}) => {
  const [error, setError] = useState<string>();
  const [inspectedId, setInspectedId] = useState<string>();
  const [restoringId, setRestoringId] = useState<string>();
  const [items, setItems] = useState(versions);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const loadOlder = async () => {
    if (cursor === null) return;
    setError(undefined);
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/versions?cursor=${cursor}`,
      );
      const nextCursorHeader = response.headers.get("X-Next-Cursor");
      const olderVersions = await readApiData<Version[]>(
        response,
        "Could not load older versions",
      );
      setItems((current) => {
        const knownIds = new Set(current.map((version) => version.id));
        return [
          ...current,
          ...olderVersions.filter((version) => !knownIds.has(version.id)),
        ];
      });
      setCursor(nextCursorHeader === null ? null : Number(nextCursorHeader));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load older versions",
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  const restore = async (version: Version) => {
    if (
      !window.confirm(
        `Replace the current draft with version ${version.versionNumber}?`,
      )
    )
      return;
    setError(undefined);
    setRestoringId(version.id);
    onRestoringChange?.(true);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/versions/${version.id}/restore`,
        {
          body: JSON.stringify({ expectedRevision: draftRevision }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const restored = await readApiData<{
        draftRevision: string;
        draftSchema: FormSchemaV1;
        versionNumber: number;
      }>(response, "Could not restore version");
      onRestore(
        restored.draftSchema,
        restored.versionNumber,
        restored.draftRevision,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not restore version",
      );
    } finally {
      setRestoringId(undefined);
      onRestoringChange?.(false);
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
        {error && !inspectedId ? <Alert className="mb-3">{error}</Alert> : null}
        {items.length === 0 ? (
          <p className="text-sm text-slate-600">No published versions yet.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((version) => {
              const diff = compareSchemas(version.schema, currentSchema);
              return (
                <li
                  key={version.id}
                  className="rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        Version {version.versionNumber}
                      </div>
                      <LocalDateTime
                        className="text-xs text-slate-500"
                        value={version.publishedAt}
                      />
                    </div>
                    <Dialog
                      open={inspectedId === version.id}
                      onOpenChange={(open) =>
                        setInspectedId(open ? version.id : undefined)
                      }
                    >
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">
                          Inspect
                        </Button>
                      </DialogTrigger>
                      <DialogContent variant="panel">
                        <div className="shrink-0 border-b border-slate-200 px-6 py-5 pr-12">
                          <DialogTitle>
                            Version {version.versionNumber}
                          </DialogTitle>
                          <DialogDescription>
                            Changes in the current draft compared with this
                            version: {diff.added} added, {diff.changed} changed,{" "}
                            {diff.removed} removed fields.
                            {diff.orderChanged ? " Field order changed." : ""}
                            {diff.formSettingsChanged
                              ? " Form settings changed."
                              : ""}
                          </DialogDescription>
                        </div>
                        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5">
                          <VersionComparison
                            comparison={diff}
                            versionNumber={version.versionNumber}
                          />
                        </div>
                        <div className="shrink-0 space-y-3 border-t border-slate-200 px-6 py-4">
                          {error ? <Alert>{error}</Alert> : null}
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm text-slate-500">
                              Restore this version as an editable draft.
                            </p>
                            <Button
                              disabled={!canEdit || restoringId !== undefined}
                              variant="secondary"
                              onClick={() => void restore(version)}
                            >
                              <RotateCcw className="size-4" />
                              {restoringId === version.id
                                ? "Restoring…"
                                : "Use as draft"}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {cursor !== null ? (
          <Button
            className="mt-4"
            disabled={loadingOlder}
            variant="secondary"
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Loading…" : "Load older versions"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
};
