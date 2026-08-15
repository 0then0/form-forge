import { Badge } from "@form-forge/ui";
import { FileText, Inbox, Settings, Webhook } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireWorkspace } from "@/auth/permissions";
import { SignOutButton } from "@/components/sign-out-button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { listUserWorkspaces } from "@/services/workspaces";

const navigation = [
  { href: "forms", icon: FileText, label: "Forms" },
  { href: "submissions", icon: Inbox, label: "Submissions" },
  { href: "deliveries", icon: Webhook, label: "Deliveries" },
  { href: "settings", icon: Settings, label: "Settings" },
] as const;

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await requireWorkspace(workspaceSlug);
  const workspaces = await listUserWorkspaces(workspace.user.id);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
          <Link href={`/app/${workspaceSlug}/forms`} className="font-semibold">
            Form Forge
          </Link>
          <div className="h-5 w-px bg-slate-200" />
          <WorkspaceSwitcher
            currentSlug={workspaceSlug}
            workspaces={workspaces}
          />
          <Badge className="hidden sm:inline-flex">{workspace.role}</Badge>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-52 truncate text-sm text-slate-600 sm:block">
              {workspace.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-screen-2xl md:grid-cols-[220px_1fr]">
        <aside className="border-b border-slate-200 bg-white p-3 md:min-h-[calc(100vh-4rem)] md:border-r md:border-b-0">
          <nav aria-label="Workspace" className="flex gap-1 md:flex-col">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={`/app/${workspaceSlug}/${item.href}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <item.icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
