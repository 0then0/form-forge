import { Card, CardContent, CardHeader, EmptyState } from "@form-forge/ui";
import Link from "next/link";

import { canManageMembers, requireWorkspace } from "@/auth/permissions";
import { CreateWebhookForm } from "@/components/webhooks/create-webhook-form";
import { WebhookEndpointCard } from "@/components/webhooks/webhook-endpoint-card";
import { getForm } from "@/services/forms";
import { listWebhookEndpoints } from "@/services/webhook-endpoints";

export default async function WebhooksPage({
  params,
}: {
  params: Promise<{ formId: string; workspaceSlug: string }>;
}) {
  const { formId, workspaceSlug } = await params;
  const [workspace, form, endpoints] = await Promise.all([
    requireWorkspace(workspaceSlug),
    getForm(workspaceSlug, formId),
    listWebhookEndpoints(workspaceSlug, formId),
  ]);

  return (
    <div>
      <Link
        href={`/app/${workspaceSlug}/forms/${formId}`}
        className="text-sm text-slate-600 hover:text-slate-950"
      >
        ← Back to {form.name}
      </Link>
      <div className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="mt-1 text-sm text-slate-600">
          Deliver each submission through signed, inspectable HTTP attempts.
        </p>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {endpoints.length === 0 ? (
            <EmptyState
              title="No webhook endpoints"
              description="Create an HTTPS endpoint to begin delivery for new submissions."
            />
          ) : (
            <div className="space-y-3">
              {endpoints.map((endpoint) => (
                <WebhookEndpointCard
                  key={endpoint.id}
                  canManage={canManageMembers(workspace.role)}
                  endpoint={endpoint}
                  formId={formId}
                  workspaceSlug={workspaceSlug}
                />
              ))}
            </div>
          )}
        </div>
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Add endpoint</h2>
          </CardHeader>
          <CardContent>
            <CreateWebhookForm
              disabled={!canManageMembers(workspace.role)}
              formId={formId}
              workspaceSlug={workspaceSlug}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
