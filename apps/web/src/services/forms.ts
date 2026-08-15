import "server-only";

import {
  defaultFormSchema,
  formSchemaV1Schema,
  type FormSchemaV1,
} from "@form-forge/form-schema";
import { and, desc, eq, lt, max, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import { cache } from "react";
import { z } from "zod";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import { auditLogs, forms, formVersions } from "@/db/schema";
import { AppError, notFoundError } from "@/lib/errors";
import { slugify } from "@/lib/slug";

const hashSchema = (schema: FormSchemaV1): string =>
  createHash("sha256").update(JSON.stringify(schema)).digest("hex");

const uniqueFormSlug = (name: string) =>
  `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;

const draftMutationSchema = z
  .object({
    expectedRevision: z.iso.datetime(),
    schema: formSchemaV1Schema,
  })
  .strict();

const assertDraftRevision = (actual: Date, expected: string) => {
  if (actual.getTime() !== new Date(expected).getTime()) {
    throw new AppError(
      "CONFLICT",
      "This draft changed in another session. Reload before continuing.",
      409,
    );
  }
};

const nextDraftRevision = (current: Date): Date =>
  new Date(Math.max(Date.now(), current.getTime() + 1));

export const listActiveForms = async (workspaceSlug: string) => {
  const workspace = await requireWorkspace(workspaceSlug);
  const rows = await db
    .select({
      id: forms.id,
      name: forms.name,
      slug: forms.slug,
      status: forms.status,
      publishedVersionId: forms.publishedVersionId,
      updatedAt: forms.updatedAt,
    })
    .from(forms)
    .where(
      and(eq(forms.workspaceId, workspace.id), ne(forms.status, "archived")),
    )
    .orderBy(desc(forms.updatedAt));
  return rows;
};

export const createForm = async (workspaceSlug: string, name: string) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  const schema = { ...defaultFormSchema(), title: name };

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(forms)
      .values({
        createdBy: workspace.user.id,
        draftSchema: schema,
        name,
        slug: uniqueFormSlug(name),
        workspaceId: workspace.id,
      })
      .returning();
    if (!created) throw new Error("Form creation did not return a row");

    await tx.insert(auditLogs).values({
      action: "form.created",
      actorId: workspace.user.id,
      metadata: { name: created.name },
      resourceId: created.id,
      resourceType: "form",
      workspaceId: workspace.id,
    });
    return created;
  });
};

export const getForm = cache(async (workspaceSlug: string, formId: string) => {
  const workspace = await requireWorkspace(workspaceSlug);
  const [form] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
    .limit(1);
  if (!form || form.status === "archived")
    throw notFoundError("Form not found");

  return { ...form, draftSchema: formSchemaV1Schema.parse(form.draftSchema) };
});

export const saveDraft = async (
  workspaceSlug: string,
  formId: string,
  input: unknown,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  const { expectedRevision, schema } = draftMutationSchema.parse(input);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: forms.id,
        status: forms.status,
        updatedAt: forms.updatedAt,
      })
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
      .limit(1)
      .for("update");
    if (!existing || existing.status === "archived") {
      throw notFoundError("Form not found");
    }
    assertDraftRevision(existing.updatedAt, expectedRevision);

    const [updated] = await tx
      .update(forms)
      .set({
        draftSchema: schema,
        name: schema.title,
        updatedAt: nextDraftRevision(existing.updatedAt),
      })
      .where(eq(forms.id, formId))
      .returning();
    if (!updated) throw new Error("Draft update did not return a row");

    await tx.insert(auditLogs).values({
      action: "form.draft_saved",
      actorId: workspace.user.id,
      metadata: { fieldCount: schema.fields.length },
      resourceId: formId,
      resourceType: "form",
      workspaceId: workspace.id,
    });
    return updated;
  });
};

export const publishForm = async (
  workspaceSlug: string,
  formId: string,
  input: unknown,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  const { expectedRevision, schema } = draftMutationSchema.parse(input);

  return db.transaction(async (tx) => {
    const [form] = await tx
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
      .limit(1)
      .for("update");
    if (!form || form.status === "archived")
      throw notFoundError("Form not found");

    assertDraftRevision(form.updatedAt, expectedRevision);
    if (schema.fields.length === 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Add at least one field before publishing",
        422,
      );
    }
    const schemaHash = hashSchema(schema);
    const [currentVersion] = form.publishedVersionId
      ? await tx
          .select({ schemaHash: formVersions.schemaHash })
          .from(formVersions)
          .where(eq(formVersions.id, form.publishedVersionId))
          .limit(1)
      : [];
    if (currentVersion?.schemaHash === schemaHash) {
      throw new AppError(
        "CONFLICT",
        "This draft is identical to a published version",
        409,
      );
    }

    const [latest] = await tx
      .select({ value: max(formVersions.versionNumber) })
      .from(formVersions)
      .where(eq(formVersions.formId, formId));
    const versionNumber = (latest?.value ?? 0) + 1;

    const [version] = await tx
      .insert(formVersions)
      .values({
        formId,
        publishedBy: workspace.user.id,
        schema,
        schemaHash,
        versionNumber,
      })
      .returning();
    if (!version) throw new Error("Version creation did not return a row");

    const [updatedForm] = await tx
      .update(forms)
      .set({
        draftSchema: schema,
        name: schema.title,
        publishedVersionId: version.id,
        status: "published",
        updatedAt: nextDraftRevision(form.updatedAt),
      })
      .where(eq(forms.id, formId))
      .returning({ updatedAt: forms.updatedAt });
    if (!updatedForm) throw new Error("Published form update returned no row");

    await tx.insert(auditLogs).values({
      action: "form.published",
      actorId: workspace.user.id,
      metadata: { schemaHash, versionNumber },
      resourceId: formId,
      resourceType: "form",
      workspaceId: workspace.id,
    });
    return {
      ...version,
      draftRevision: updatedForm.updatedAt.toISOString(),
    };
  });
};

export const listFormVersions = async (
  workspaceSlug: string,
  formId: string,
  cursor?: number,
) => {
  await getForm(workspaceSlug, formId);
  const limit = 10;
  const rows = await db
    .select({
      id: formVersions.id,
      publishedAt: formVersions.publishedAt,
      schema: formVersions.schema,
      schemaHash: formVersions.schemaHash,
      versionNumber: formVersions.versionNumber,
    })
    .from(formVersions)
    .where(
      cursor === undefined
        ? eq(formVersions.formId, formId)
        : and(
            eq(formVersions.formId, formId),
            lt(formVersions.versionNumber, cursor),
          ),
    )
    .orderBy(desc(formVersions.versionNumber))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    nextCursor: hasMore ? (data.at(-1)?.versionNumber ?? null) : null,
  };
};

export const restoreDraftFromVersion = async (
  workspaceSlug: string,
  formId: string,
  versionId: string,
  expectedRevision: string,
) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");

  return db.transaction(async (tx) => {
    const [form] = await tx
      .select({
        id: forms.id,
        status: forms.status,
        updatedAt: forms.updatedAt,
      })
      .from(forms)
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
      .limit(1)
      .for("update");
    if (!form || form.status === "archived") {
      throw notFoundError("Form not found");
    }
    assertDraftRevision(
      form.updatedAt,
      z.iso.datetime().parse(expectedRevision),
    );

    const [version] = await tx
      .select({
        id: formVersions.id,
        schema: formVersions.schema,
        versionNumber: formVersions.versionNumber,
      })
      .from(formVersions)
      .where(
        and(eq(formVersions.id, versionId), eq(formVersions.formId, formId)),
      )
      .limit(1);
    if (!version) throw notFoundError("Form version not found");

    const schema = formSchemaV1Schema.parse(version.schema);
    const [updated] = await tx
      .update(forms)
      .set({
        draftSchema: schema,
        name: schema.title,
        updatedAt: nextDraftRevision(form.updatedAt),
      })
      .where(eq(forms.id, form.id))
      .returning({
        draftSchema: forms.draftSchema,
        updatedAt: forms.updatedAt,
      });
    if (!updated) throw new Error("Draft restore did not return a row");

    await tx.insert(auditLogs).values({
      action: "form.version_restored",
      actorId: workspace.user.id,
      metadata: { versionId: version.id, versionNumber: version.versionNumber },
      resourceId: formId,
      resourceType: "form",
      workspaceId: workspace.id,
    });

    return {
      draftRevision: updated.updatedAt.toISOString(),
      draftSchema: schema,
      versionNumber: version.versionNumber,
    };
  });
};

export const archiveForm = async (workspaceSlug: string, formId: string) => {
  const workspace = await requireWorkspace(workspaceSlug, "editor");
  return db.transaction(async (tx) => {
    const [archived] = await tx
      .update(forms)
      .set({
        archivedAt: new Date(),
        status: "archived",
        updatedAt: new Date(),
      })
      .where(and(eq(forms.id, formId), eq(forms.workspaceId, workspace.id)))
      .returning({ id: forms.id });
    if (!archived) throw notFoundError("Form not found");
    await tx.insert(auditLogs).values({
      action: "form.archived",
      actorId: workspace.user.id,
      metadata: {},
      resourceId: formId,
      resourceType: "form",
      workspaceId: workspace.id,
    });
    return archived;
  });
};
