import { Badge, EmptyState } from "@form-forge/ui";
import { FileText } from "lucide-react";
import Link from "next/link";

import { canEdit, requireWorkspace } from "@/auth/permissions";
import { CreateFormButton } from "@/components/create-form-button";
import { listActiveForms } from "@/services/forms";

export default async function FormsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [workspace, forms] = await Promise.all([
    requireWorkspace(workspaceSlug),
    listActiveForms(workspaceSlug),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
          <p className="mt-1 text-sm text-slate-600">
            Draft, publish, and inspect immutable schema versions.
          </p>
        </div>
        <CreateFormButton
          disabled={!canEdit(workspace.role)}
          workspaceSlug={workspaceSlug}
        />
      </div>
      {forms.length === 0 ? (
        <EmptyState
          title="No forms yet"
          description="Create a schema draft, add fields, preview it, and publish the first version."
          action={
            <CreateFormButton
              disabled={!canEdit(workspace.role)}
              workspaceSlug={workspaceSlug}
            />
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-100">
            {forms.map((form) => (
              <li key={form.id}>
                <Link
                  href={`/app/${workspaceSlug}/forms/${form.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50"
                >
                  <div className="rounded-lg bg-slate-100 p-2">
                    <FileText className="size-5 text-slate-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-950">
                      {form.name}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      /f/{form.slug}
                    </p>
                  </div>
                  <Badge
                    tone={form.status === "published" ? "success" : "neutral"}
                  >
                    {form.status}
                  </Badge>
                  <time
                    className="hidden text-sm text-slate-500 sm:block"
                    dateTime={form.updatedAt.toISOString()}
                  >
                    {form.updatedAt.toISOString().slice(0, 10)} UTC
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
