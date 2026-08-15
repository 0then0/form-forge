import { canManageMembers, requireWorkspace } from "@/auth/permissions";
import { MembersManager } from "@/components/members-manager";
import { listMembers } from "@/services/memberships";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [workspace, members] = await Promise.all([
    requireWorkspace(workspaceSlug),
    listMembers(workspaceSlug),
  ]);
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Workspace access
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Owners manage access. Editors can change forms and retry deliveries.
          Viewers are read-only.
        </p>
      </div>
      <MembersManager
        canManage={canManageMembers(workspace.role)}
        currentUserId={workspace.user.id}
        initialMembers={members}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}
