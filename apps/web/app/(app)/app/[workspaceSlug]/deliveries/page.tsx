import { Badge, EmptyState } from "@form-forge/ui";

import { canEdit, requireWorkspace } from "@/auth/permissions";
import { RetryButton } from "@/components/deliveries/retry-button";
import { listWorkspaceDeliveries } from "@/services/deliveries";

const statusTone = {
  failed: "danger",
  pending: "warning",
  processing: "info",
  succeeded: "success",
} as const;

export default async function DeliveriesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [workspace, deliveries] = await Promise.all([
    requireWorkspace(workspaceSlug),
    listWorkspaceDeliveries(workspaceSlug),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Deliveries</h1>
        <p className="mt-1 text-sm text-slate-600">
          Inspect current webhook state and recover terminal failures.
        </p>
      </div>
      {deliveries.length === 0 ? (
        <EmptyState
          title="No webhook deliveries"
          description="Configure a webhook on a form, then submit the published form."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Form</th>
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Attempts</th>
                <th className="px-4 py-3 font-medium">Last error</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td className="px-4 py-3 font-medium">{delivery.formName}</td>
                  <td className="px-4 py-3">{delivery.endpointName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone[delivery.status]}>
                      {delivery.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{delivery.attemptCount}</td>
                  <td className="max-w-sm truncate px-4 py-3 text-slate-600">
                    {delivery.lastError ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RetryButton
                      deliveryId={delivery.id}
                      disabled={
                        !canEdit(workspace.role) || delivery.status !== "failed"
                      }
                      workspaceSlug={workspaceSlug}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
