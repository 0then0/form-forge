"use client";

import { MAX_FORM_TEMPLATE_BYTES } from "@form-forge/form-schema";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@form-forge/ui";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";

import { ClientApiError, readApiData } from "@/lib/client-api";

type TemplatePreview = {
  digest: string;
  formatVersion: number;
  schemaVersion: number;
  workspace: { name: string; slug: string };
  title: string;
  description: string | null;
  nameInUse: boolean;
  fields: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    optionCount: number | null;
    visibleWhen: string | null;
  }[];
};

const fieldTypeLabels: Record<string, string> = {
  checkbox: "Checkbox",
  date: "Date",
  email: "Email",
  longText: "Long text",
  number: "Number",
  select: "Select",
  shortText: "Short text",
};

const errorDetails = (error: unknown): string[] =>
  error instanceof ClientApiError && error.fieldErrors
    ? Object.entries(error.fieldErrors).flatMap(([path, messages]) =>
        messages.map((message) =>
          path === "_root" ? message : `${path}: ${message}`,
        ),
      )
    : [];

export const ImportTemplateButton = ({
  disabled,
  workspaceName,
  workspaceSlug,
}: {
  disabled: boolean;
  workspaceName: string;
  workspaceSlug: string;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ raw: string; preview: TemplatePreview }>();
  const [error, setError] = useState<{ message: string; details: string[] }>();
  const [pending, setPending] = useState<"preview" | "import">();
  // Ignores a preview response for a file that has since been replaced.
  const selection = useRef(0);
  const endpoint = `/api/admin/workspaces/${workspaceSlug}/forms/import`;

  const reset = () => {
    selection.current += 1;
    setFile(undefined);
    setError(undefined);
    setPending(undefined);
  };

  const fail = (caught: unknown, fallback: string) =>
    setError({
      message: caught instanceof Error ? caught.message : fallback,
      details: errorDetails(caught),
    });

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    reset();
    const current = selection.current;
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > MAX_FORM_TEMPLATE_BYTES) {
      setError({
        message: `The file is larger than ${MAX_FORM_TEMPLATE_BYTES / 1_000_000} MB.`,
        details: [],
      });
      return;
    }
    setPending("preview");
    try {
      const raw = await selected.text();
      const response = await fetch(`${endpoint}/preview`, {
        body: raw,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const preview = await readApiData<TemplatePreview>(
        response,
        "Could not read the template",
      );
      if (current === selection.current) setFile({ raw, preview });
    } catch (caught) {
      if (current === selection.current)
        fail(caught, "Could not read the template");
    } finally {
      if (current === selection.current) setPending(undefined);
    }
  };

  const importTemplate = async () => {
    if (!file) return;
    setPending("import");
    setError(undefined);
    try {
      const response = await fetch(
        `${endpoint}?digest=${file.preview.digest}`,
        {
          body: file.raw,
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const created = await readApiData<{ id: string }>(
        response,
        "Could not import the template",
      );
      changeOpen(false);
      router.push(`/app/${workspaceSlug}/forms/${created.id}`);
      router.refresh();
    } catch (caught) {
      fail(caught, "Could not import the template");
    } finally {
      setPending(undefined);
    }
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const preview = file?.preview;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled} variant="secondary">
          <Upload className="size-4" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Import a form template</DialogTitle>
        <DialogDescription>
          Creates a new unpublished draft in {workspaceName} from a Form Forge
          template file. Existing forms are not changed.
        </DialogDescription>
        <div className="mt-6 space-y-2">
          <Label htmlFor="template-file">Template file</Label>
          <Input
            id="template-file"
            type="file"
            accept=".json,application/json"
            disabled={pending === "import"}
            onChange={(event) => void selectFile(event)}
          />
        </div>
        {pending === "preview" ? (
          <p role="status" className="mt-4 text-sm text-slate-600">
            Checking the template…
          </p>
        ) : null}
        {preview ? (
          <section
            aria-label="Template preview"
            className="mt-5 space-y-3 rounded-lg border border-slate-200 p-4 text-sm"
          >
            <div>
              <p className="font-semibold text-slate-950">{preview.title}</p>
              {preview.description ? (
                <p className="mt-1 text-slate-600">{preview.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-500">
                Template format {preview.formatVersion}, schema version{" "}
                {preview.schemaVersion}
              </p>
            </div>
            <p>
              {preview.fields.length === 1
                ? "1 field"
                : `${preview.fields.length} fields`}
            </p>
            {preview.fields.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-5">
                {preview.fields.map((field) => (
                  <li key={field.key}>
                    <span className="font-medium">{field.label}</span>{" "}
                    <span className="text-slate-600">
                      · {fieldTypeLabels[field.type] ?? field.type}
                      {field.required ? " · required" : ""}
                      {field.optionCount === null
                        ? ""
                        : ` · ${field.optionCount} options`}
                      {field.visibleWhen === null
                        ? ""
                        : ` · shown depending on ${field.visibleWhen}`}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            {preview.nameInUse ? (
              <p className="text-amber-800 dark:text-amber-300">
                A form named “{preview.title}” already exists in this workspace.
                The import creates a separate form with its own address.
              </p>
            ) : null}
            <p className="text-slate-600">
              The new draft is not published and starts with the default intake
              settings for new forms. Responses, webhooks and members are not
              part of a template.
            </p>
          </section>
        ) : null}
        {error === undefined ? null : (
          <div role="alert" className="mt-4 text-sm text-red-700">
            <p>{error.message}</p>
            {error.details.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {error.details.slice(0, 20).map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!preview || pending !== undefined}
            onClick={() => void importTemplate()}
          >
            {pending === "import" ? "Creating…" : "Create draft"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
