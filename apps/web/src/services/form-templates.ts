import "server-only";

import {
  createFormTemplate,
  MAX_FORM_TEMPLATE_BYTES,
  parseFormTemplate,
} from "@form-forge/form-schema";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import { forms } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import { assertDraftRevision, createDraftForm, getForm } from "./forms";

const templateDigest = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

// Validation happens before any write, so a rejected file never creates a form.
const readTemplate = (raw: string) => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppError("BAD_REQUEST", "The file is not valid JSON", 400);
  }
  const result = parseFormTemplate(value);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.issues) {
      fieldErrors[issue.path] = [
        ...(fieldErrors[issue.path] ?? []),
        issue.message,
      ];
    }
    throw new AppError(
      "VALIDATION_ERROR",
      result.message,
      422,
      result.issues.length === 0 ? undefined : fieldErrors,
    );
  }
  return result.template;
};

// Exports the saved draft only. The revision ties the file to the draft the
// editor shows, so a draft saved elsewhere is never passed off as current.
export const exportFormTemplate = async (
  workspaceSlug: string,
  formId: string,
  expectedRevision: unknown,
) => {
  const revision = z.iso.datetime().parse(expectedRevision);
  const form = await getForm(workspaceSlug, formId);
  assertDraftRevision(form.updatedAt, revision);

  const template = createFormTemplate(form.draftSchema);
  const readable = `${JSON.stringify(template, null, 2)}\n`;
  return {
    body:
      Buffer.byteLength(readable) <= MAX_FORM_TEMPLATE_BYTES
        ? readable
        : JSON.stringify(template),
    fileName: `${slugify(form.draftSchema.title, "form")}.form-template.json`,
  };
};

export const previewFormTemplate = async (
  workspaceSlug: string,
  raw: string,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  const { form, formatVersion } = readTemplate(raw);
  const [sameName] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspace.id), eq(forms.name, form.title)))
    .limit(1);
  const labels = new Map(form.fields.map((field) => [field.key, field.label]));

  return {
    digest: templateDigest(raw),
    formatVersion,
    schemaVersion: form.schemaVersion,
    workspace: { name: workspace.name, slug: workspace.slug },
    title: form.title,
    description: form.description ?? null,
    nameInUse: sameName !== undefined,
    fields: form.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      optionCount: field.type === "select" ? field.options.length : null,
      visibleWhen:
        field.visibility === undefined
          ? null
          : (labels.get(field.visibility.fieldKey) ?? null),
    })),
  };
};

// Creates a separate unpublished draft. Each confirmed import creates a new
// form; it never updates an existing one.
export const importFormTemplate = async (
  workspaceSlug: string,
  raw: string,
  previewDigest: unknown,
) => {
  await requireWorkspace(workspaceSlug, "editor");
  const digest = digestSchema.safeParse(previewDigest);
  if (!digest.success) {
    throw new AppError(
      "BAD_REQUEST",
      "Preview the template before importing it",
      400,
    );
  }
  if (templateDigest(raw) !== digest.data) {
    throw new AppError(
      "CONFLICT",
      "The file changed after preview. Review the new file before importing it.",
      409,
    );
  }
  const { form, formatVersion } = readTemplate(raw);
  const created = await createDraftForm(workspaceSlug, form, {
    fieldCount: form.fields.length,
    source: "template",
    templateFormatVersion: formatVersion,
  });
  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    status: created.status,
  };
};
