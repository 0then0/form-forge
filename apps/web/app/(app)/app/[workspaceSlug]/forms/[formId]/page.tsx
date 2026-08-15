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
  const [workspace, form, versions] = await Promise.all([
    requireWorkspace(workspaceSlug),
    getForm(workspaceSlug, formId),
    listFormVersions(workspaceSlug, formId),
  ]);

  return (
    <SchemaEditor
      canEdit={canEdit(workspace.role)}
      formId={form.id}
      initialSchema={form.draftSchema}
      publicSlug={form.slug}
      publicBaseUrl={env.NEXT_PUBLIC_APP_URL}
      published={form.status === "published"}
      versions={versions.map((version) => ({
        id: version.id,
        publishedAt: version.publishedAt.toISOString(),
        versionNumber: version.versionNumber,
      }))}
      workspaceSlug={workspaceSlug}
    />
  );
}
