"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@form-forge/ui";
import { Download } from "lucide-react";
import { useState } from "react";

import { readApiData } from "@/lib/client-api";

const fallbackFileName = "form.form-template.json";

const saveFile = (blob: Blob, fileName: string) => {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
};

export const ExportTemplateButton = ({
  canSave,
  dirty,
  disabled,
  draftRevision,
  formId,
  onSave,
  saving,
  workspaceSlug,
}: {
  canSave: boolean;
  dirty: boolean;
  disabled: boolean;
  draftRevision: string;
  formId: string;
  onSave: () => void;
  saving: boolean;
  workspaceSlug: string;
}) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const changeOpen = (next: boolean) => {
    setOpen(next);
    setError(undefined);
  };

  const download = async () => {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/template?revision=${encodeURIComponent(draftRevision)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        await readApiData<never>(response, "Could not export the template");
      }
      const fileName =
        /filename="([^"]+)"/.exec(
          response.headers.get("Content-Disposition") ?? "",
        )?.[1] ?? fallbackFileName;
      saveFile(await response.blob(), fileName);
      changeOpen(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not export the template",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled} variant="secondary">
          <Download className="size-4" /> Export
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Export the saved draft</DialogTitle>
        {dirty ? (
          <DialogDescription>
            This editor has unsaved changes. The template contains only the
            saved draft, so save your changes before exporting.
          </DialogDescription>
        ) : (
          <DialogDescription>
            Downloads the current saved draft as a versioned JSON template. The
            published version, responses, intake settings, webhooks and members
            are not included.
          </DialogDescription>
        )}
        {dirty && !canSave && !saving ? (
          <p className="mt-4 text-sm text-slate-600">
            Fix the highlighted problems in the editor before saving.
          </p>
        ) : null}
        {error === undefined ? null : (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          {dirty ? (
            <Button disabled={!canSave || saving} onClick={onSave}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
          ) : (
            <Button disabled={pending} onClick={() => void download()}>
              <Download className="size-4" />
              {pending ? "Preparing…" : "Download saved draft"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
