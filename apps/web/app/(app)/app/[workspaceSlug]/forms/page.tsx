import { Badge, EmptyState } from "@form-forge/ui";
import { FileText } from "lucide-react";
import Link from "next/link";

import { canEdit, requireWorkspace } from "@/auth/permissions";
import { CreateFormButton } from "@/components/create-form-button";
import { LocalDateTime } from "@/components/local-date-time";
import { FormListActions } from "@/components/form-list-actions";
import { listArchivedForms, listActiveForms } from "@/services/forms";

export default async function FormsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { workspaceSlug } = await params;
  const archived = (await searchParams).archived === "1";
  const [workspace, forms] = await Promise.all([
    requireWorkspace(workspaceSlug),
    archived
      ? listArchivedForms(workspaceSlug)
      : listActiveForms(workspaceSlug),
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
      <nav aria-label="Form status" className="mb-5 flex gap-2 text-sm">
        <Link
          href={`/app/${workspaceSlug}/forms`}
          aria-current={!archived ? "page" : undefined}
          className={`rounded-md px-3 py-2 ${!archived ? "bg-slate-200 font-semibold" : "hover:bg-slate-100"}`}
        >
          Active
        </Link>
        <Link
          href={`/app/${workspaceSlug}/forms?archived=1`}
          aria-current={archived ? "page" : undefined}
          className={`rounded-md px-3 py-2 ${archived ? "bg-slate-200 font-semibold" : "hover:bg-slate-100"}`}
        >
          Archived
        </Link>
      </nav>
      {forms.length === 0 ? (
        <EmptyState
          title={archived ? "No archived forms" : "No forms yet"}
          description={
            archived
              ? "Archived forms can be restored here or permanently deleted by a workspace owner."
              : "Create a schema draft, add fields, preview it, and publish the first version."
          }
          action={
            archived ? undefined : (
              <CreateFormButton
                disabled={!canEdit(workspace.role)}
                workspaceSlug={workspaceSlug}
              />
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-100">
            {forms.map((form) => (
              <li
                key={form.id}
                className="flex flex-wrap items-center gap-4 px-5 py-4"
              >
                <div className="relative flex min-w-0 flex-1 items-center gap-4">
                  <div className="rounded-lg bg-slate-100 p-2">
                    <FileText className="size-5 text-slate-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-950">
                      <Link
                        href={`/app/${workspaceSlug}/forms/${form.id}`}
                        className="after:absolute after:inset-0 hover:underline"
                      >
                        {form.name}
                      </Link>
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
                  {!archived ? (
                    <LocalDateTime
                      className="hidden text-sm text-slate-500 sm:block"
                      value={form.updatedAt}
                    />
                  ) : null}
                </div>
                {archived ? (
                  <dl className="flex w-full flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500 sm:w-auto">
                    <div>
                      <dt className="mb-1 font-medium text-slate-600">
                        Archived
                      </dt>
                      <dd>
                        {form.archivedAt ? (
                          <LocalDateTime value={form.archivedAt} />
                        ) : (
                          "Not recorded"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="mb-1 font-medium text-slate-600">
                        Last saved
                      </dt>
                      <dd>
                        {form.lastSavedAt ? (
                          <LocalDateTime value={form.lastSavedAt} />
                        ) : (
                          "Not recorded"
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                <FormListActions
                  form={{ ...form, updatedAt: form.updatedAt.toISOString() }}
                  workspaceSlug={workspaceSlug}
                  canEdit={canEdit(workspace.role)}
                  canDelete={workspace.role === "owner"}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
