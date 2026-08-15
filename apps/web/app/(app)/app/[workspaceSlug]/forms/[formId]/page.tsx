import { canEdit, requireWorkspace } from "@/auth/permissions";
import { SchemaEditor } from "@/components/editor/schema-editor";
import { env } from "@/env";
import { getForm, listFormVersions } from "@/services/forms";

export default async function FormEditorPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; formId: string }>;
}) {
  const { formId, workspaceSlug } = await params;
  const [workspace, form, versionPage] = await Promise.all([
    requireWorkspace(workspaceSlug),
    getForm(workspaceSlug, formId),
    listFormVersions(workspaceSlug, formId),
  ]);

  return (
    <SchemaEditor
      canEdit={canEdit(workspace.role)}
      formId={form.id}
      initialDraftRevision={form.updatedAt.toISOString()}
      initialSchema={form.draftSchema}
      publicSlug={form.slug}
      publicBaseUrl={env.APP_URL.replace(/\/$/, "")}
      published={form.status === "published"}
      initialVersionCursor={versionPage.nextCursor}
      versions={versionPage.data.map((version) => ({
        id: version.id,
        publishedAt: version.publishedAt.toISOString(),
        schema: version.schema,
        versionNumber: version.versionNumber,
      }))}
      workspaceSlug={workspaceSlug}
    />
  );
}
