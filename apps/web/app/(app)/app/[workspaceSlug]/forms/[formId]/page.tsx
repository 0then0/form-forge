import { canEdit, requireWorkspace } from "@/auth/permissions";
import { SchemaEditor } from "@/components/editor/schema-editor";
import { OperationalSettings } from "@/components/editor/operational-settings";
import { env } from "@/env";
import { ArchivedFormView } from "@/components/editor/archived-form-view";
import { getFormForViewing, listFormVersions } from "@/services/forms";

export default async function FormEditorPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; formId: string }>;
}) {
  const { formId, workspaceSlug } = await params;
  const [workspace, form, versionPage] = await Promise.all([
    requireWorkspace(workspaceSlug),
    getFormForViewing(workspaceSlug, formId),
    listFormVersions(workspaceSlug, formId),
  ]);

  if (form.status === "archived") {
    return (
      <ArchivedFormView
        schema={form.draftSchema}
        archivedAt={form.archivedAt?.toISOString() ?? null}
        formId={form.id}
        draftRevision={form.updatedAt.toISOString()}
        versions={versionPage.data.map((version) => ({
          ...version,
          publishedAt: version.publishedAt.toISOString(),
        }))}
        initialVersionCursor={versionPage.nextCursor}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  return (
    <div>
      <OperationalSettings
        canEdit={canEdit(workspace.role)}
        workspaceSlug={workspaceSlug}
        formId={form.id}
        acceptedCount={form.acceptedCount}
        initialRevision={form.policyUpdatedAt.toISOString()}
        initialPolicy={{
          collectMetadata: form.collectMetadata,
          paused: form.paused,
          closesAt: form.closesAt?.toISOString() ?? null,
          maxAccepted: form.maxAccepted,
          closedMessage: form.closedMessage,
        }}
      />
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
    </div>
  );
}
