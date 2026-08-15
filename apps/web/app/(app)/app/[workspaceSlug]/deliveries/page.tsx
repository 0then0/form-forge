import { Badge, Button, EmptyState, Select } from "@form-forge/ui";
import Link from "next/link";
import { z } from "zod";

import { canEdit, requireWorkspace } from "@/auth/permissions";
import { RetryButton } from "@/components/deliveries/retry-button";
import { listWorkspaceDeliveries } from "@/services/deliveries";
import { listActiveForms } from "@/services/forms";

const statusTone = {
  failed: "danger",
  pending: "warning",
  processing: "info",
  succeeded: "success",
} as const;

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    cursor?: string;
    formId?: string;
    status?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const status = ["pending", "processing", "succeeded", "failed"].includes(
    query.status ?? "",
  )
    ? (query.status as "pending" | "processing" | "succeeded" | "failed")
    : undefined;
  const formId = z.uuid().safeParse(query.formId).data;
  const [workspace, deliveryPage, activeForms] = await Promise.all([
    requireWorkspace(workspaceSlug),
    listWorkspaceDeliveries({
      workspaceSlug,
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(formId ? { formId } : {}),
      ...(status ? { status } : {}),
    }),
    listActiveForms(workspaceSlug),
  ]);
  const deliveries = deliveryPage.data;
  const nextParams = new URLSearchParams();
  if (status) nextParams.set("status", status);
  if (formId) nextParams.set("formId", formId);
  if (deliveryPage.nextCursor)
    nextParams.set("cursor", deliveryPage.nextCursor);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Deliveries</h1>
        <p className="mt-1 text-sm text-slate-600">
          Inspect current webhook state and recover terminal failures.
        </p>
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm font-medium">
          <span className="block">Status</span>
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span className="block">Form</span>
          <Select name="formId" defaultValue={formId ?? ""}>
            <option value="">All forms</option>
            {activeForms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
      </form>
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
      {deliveryPage.nextCursor ? (
        <div className="mt-4 text-center">
          <Button asChild variant="secondary">
            <Link href={`?${nextParams.toString()}`}>Next page</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
