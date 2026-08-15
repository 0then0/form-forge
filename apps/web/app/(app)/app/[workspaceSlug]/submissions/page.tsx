import { SubmissionsTable } from "@/components/submissions/submissions-table";

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
        <p className="mt-1 text-sm text-slate-600">
          Version-aware responses and their aggregate delivery status.
        </p>
      </div>
      <SubmissionsTable workspaceSlug={workspaceSlug} />
    </div>
  );
}
