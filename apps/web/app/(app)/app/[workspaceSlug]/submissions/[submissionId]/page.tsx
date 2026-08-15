import { formSchemaV1Schema } from "@form-forge/form-schema";
import { Badge, Card, CardContent, CardHeader } from "@form-forge/ui";
import Link from "next/link";

import { canEdit, requireWorkspace } from "@/auth/permissions";
import { RetryButton } from "@/components/deliveries/retry-button";
import { getSubmissionDetail } from "@/services/submissions";

const statusTone = {
  failed: "danger",
  pending: "warning",
  processing: "info",
  succeeded: "success",
} as const;

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string; workspaceSlug: string }>;
}) {
  const { submissionId, workspaceSlug } = await params;
  const [workspace, detail] = await Promise.all([
    requireWorkspace(workspaceSlug),
    getSubmissionDetail(workspaceSlug, submissionId),
  ]);
  const schema = formSchemaV1Schema.parse(detail.submission.schema);
  const fieldLabels = new Map(
    schema.fields.map((field) => [field.key, field.label]),
  );

  return (
    <div>
      <Link
        href={`/app/${workspaceSlug}/submissions`}
        className="text-sm text-slate-600 hover:text-slate-950"
      >
        ← Back to submissions
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.submission.formName} submission
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Version {detail.submission.versionNumber} ·{" "}
            {detail.submission.createdAt.toLocaleString()}
          </p>
        </div>
        <Badge tone={statusTone[detail.submission.deliveryStatus]}>
          {detail.submission.deliveryStatus}
        </Badge>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Values</h2>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-slate-100">
                {Object.entries(detail.submission.receivedValues).map(
                  ([key, value]) => (
                    <div
                      key={key}
                      className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]"
                    >
                      <dt className="text-sm font-medium text-slate-600">
                        {fieldLabels.get(key) ?? key}
                      </dt>
                      <dd className="text-sm break-words text-slate-950">
                        {String(value)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold">Delivery history</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.deliveries.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No endpoints were configured.
                </p>
              ) : (
                detail.deliveries.map((delivery) => {
                  const attempts = detail.attempts.filter(
                    (attempt) => attempt.deliveryId === delivery.id,
                  );
                  return (
                    <article
                      key={delivery.id}
                      className="rounded-lg border border-slate-200 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{delivery.endpointName}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {delivery.endpointUrl}
                          </p>
                        </div>
                        <Badge tone={statusTone[delivery.status]}>
                          {delivery.status}
                        </Badge>
                        <RetryButton
                          deliveryId={delivery.id}
                          disabled={
                            !canEdit(workspace.role) ||
                            delivery.status !== "failed" ||
                            !delivery.endpointEnabled ||
                            delivery.endpointArchivedAt !== null
                          }
                          workspaceSlug={workspaceSlug}
                        />
                      </div>
                      {attempts.length === 0 ? null : (
                        <ol className="mt-4 space-y-2 border-l border-slate-200 pl-4">
                          {attempts.map((attempt) => (
                            <li key={attempt.id} className="text-sm">
                              <span className="font-medium">
                                Attempt {attempt.attemptNumber}
                              </span>{" "}
                              <span className="text-slate-600">
                                {attempt.httpStatus
                                  ? `HTTP ${attempt.httpStatus}`
                                  : attempt.errorCode}{" "}
                                · {attempt.durationMs} ms
                              </span>
                              {attempt.requestUrl ? (
                                <p className="mt-1 truncate text-xs text-slate-500">
                                  {attempt.requestUrl}
                                </p>
                              ) : null}
                              {attempt.errorMessage ? (
                                <p className="mt-1 text-red-700">
                                  {attempt.errorMessage}
                                </p>
                              ) : null}
                              {attempt.responseExcerpt ? (
                                <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-100 p-2 text-xs whitespace-pre-wrap text-slate-700">
                                  {attempt.responseExcerpt}
                                </pre>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      )}
                    </article>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Metadata</h2>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Submission ID</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {submissionId}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Version ID</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {detail.submission.versionId}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Referrer</dt>
                  <dd className="mt-1 break-all">
                    {detail.submission.referrer ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">UTM</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {JSON.stringify(detail.submission.utm)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Fingerprint</dt>
                  <dd className="mt-1 font-mono text-xs break-all">
                    {detail.submission.fingerprintHash ?? "—"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Event timeline</h2>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4 border-l border-slate-200 pl-4">
                {detail.events.map((event) => (
                  <li key={event.id}>
                    <p className="text-sm font-medium">{event.type}</p>
                    <time className="text-xs text-slate-500">
                      {event.createdAt.toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
