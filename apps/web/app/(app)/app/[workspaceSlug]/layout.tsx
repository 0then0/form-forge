import { Badge } from "@form-forge/ui";
import { FileText, Inbox, Settings, Webhook } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireWorkspace } from "@/auth/permissions";
import { BrandMark } from "@/components/brand-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
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
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link
            href={`/app/${workspaceSlug}/forms`}
            className="hidden shrink-0 items-center gap-2 whitespace-nowrap font-semibold sm:flex"
          >
            <BrandMark className="size-7 rounded-md" />
            <span>Form Forge</span>
          </Link>
          <div className="hidden h-5 w-px shrink-0 bg-slate-200 sm:block" />
          <div className="min-w-0 max-w-xs flex-1">
            <div className="mb-0.5 flex items-center gap-2">
              <p className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                Workspace
              </p>
              <Badge className="hidden shrink-0 px-1.5 py-0 text-[10px] sm:inline-flex">
                {workspace.role}
              </Badge>
            </div>
            <WorkspaceSwitcher
              currentSlug={workspaceSlug}
              workspaces={workspaces}
            />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
            <ThemeToggle />
            <Link
              href="/account"
              aria-label="Account and sign-in methods"
              className="flex min-w-0 items-center gap-2 rounded-md p-1 hover:bg-slate-50"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700"
              >
                {(workspace.user.name || workspace.user.email || "A")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span className="hidden min-w-0 lg:block">
                <span className="block text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                  Account
                </span>
                <span className="block max-w-40 truncate text-sm font-medium">
                  {workspace.user.name || "My account"}
                </span>
              </span>
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-screen-2xl md:grid-cols-[220px_1fr]">
        <aside className="border-b border-slate-200 bg-white p-3 md:min-h-[calc(100vh-4rem)] md:border-r md:border-b-0">
          <nav
            aria-label="Workspace"
            className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
          >
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={`/app/${workspaceSlug}/${item.href}`}
                className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
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
