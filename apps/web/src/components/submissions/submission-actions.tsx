"use client";

import { Alert, Button, Input, Label } from "@form-forge/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readApiData } from "@/lib/client-api";

export const SubmissionActions = ({
  workspaceSlug,
  submissionId,
  processingStatus,
  canEdit,
  canDelete,
}: {
  workspaceSlug: string;
  submissionId: string;
  processingStatus: "new" | "processed";
  canEdit: boolean;
  canDelete: boolean;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const mutate = async (deleting: boolean) => {
    setPending(true);
    setError(undefined);
    try {
      await readApiData(
        await fetch(
          `/api/admin/workspaces/${workspaceSlug}/submissions/${submissionId}`,
          {
            method: deleting ? "DELETE" : "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              deleting
                ? { confirmation }
                : {
                    processingStatus:
                      processingStatus === "new" ? "processed" : "new",
                  },
            ),
          },
        ),
        deleting
          ? "Could not delete response"
          : "Could not change processing status",
      );
      await queryClient.invalidateQueries({
        queryKey: ["submissions", workspaceSlug],
      });
      if (deleting) router.push(`/app/${workspaceSlug}/submissions`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm">
        Processing:{" "}
        <strong>{processingStatus === "new" ? "New" : "Processed"}</strong>
      </p>
      <div className="flex flex-wrap gap-3">
        {canEdit ? (
          <Button
            disabled={pending}
            variant="secondary"
            onClick={() => void mutate(false)}
          >
            Mark as {processingStatus === "new" ? "processed" : "new"}
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => setConfirming((value) => !value)}
          >
            Delete response
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div className="max-w-xl space-y-3 rounded border border-red-200 p-4">
          <p className="text-sm">
            Permanently deletes this response, delivery history and queued work.
            Backup copies and data already received by external systems must be
            deleted separately. Consumed quotas and form places are not
            returned. The idempotency key stays blocked for 30 days using only a
            keyed hash.
          </p>
          <Label htmlFor="delete-response-confirmation">
            Type submission ID {submissionId} to confirm
          </Label>
          <Input
            id="delete-response-confirmation"
            value={confirmation}
            disabled={pending}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <Button
            variant="danger"
            disabled={pending || confirmation !== submissionId}
            onClick={() => void mutate(true)}
          >
            {pending ? "Deleting…" : "Permanently delete response"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
};
