"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Textarea,
} from "@form-forge/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { FormPolicy } from "@/lib/form-policy";
import { readApiData } from "@/lib/client-api";

export const OperationalSettings = ({
  canEdit,
  formId,
  workspaceSlug,
  initialPolicy,
  initialRevision,
  acceptedCount,
}: {
  canEdit: boolean;
  formId: string;
  workspaceSlug: string;
  initialPolicy: FormPolicy;
  initialRevision: string;
  acceptedCount: number;
}) => {
  const [policy, setPolicy] = useState(initialPolicy);
  const [revision, setRevision] = useState(initialRevision);
  const [saved, setSaved] = useState(false);
  const change = (patch: Partial<FormPolicy>) => {
    setSaved(false);
    setPolicy((current) => ({ ...current, ...patch }));
  };
  const mutation = useMutation({
    mutationFn: async () =>
      readApiData<{ policyUpdatedAt: string }>(
        await fetch(
          `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/policy`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ policy, expectedRevision: revision }),
          },
        ),
        "Could not save intake settings",
      ),
    onSuccess: (result) => {
      setRevision(result.policyUpdatedAt);
      setSaved(true);
    },
  });
  return (
    <Card className="mb-6">
      <CardContent>
        <h2 className="mb-2 font-semibold">Intake and privacy</h2>
        <p className="mb-4 text-sm text-slate-600">
          Applies immediately to every published version, including already-open
          forms. These settings do not publish a new version.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <fieldset
            disabled={!canEdit || mutation.isPending}
            className="grid gap-4 sm:grid-cols-2"
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={policy.paused}
                onChange={(event) => change({ paused: event.target.checked })}
              />{" "}
              Pause responses
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={policy.collectMetadata}
                onChange={(event) =>
                  change({ collectMetadata: event.target.checked })
                }
              />{" "}
              Collect optional source metadata
            </label>
            <p className="text-sm text-slate-600 sm:col-span-2">
              Metadata includes a persistent visitor ID fingerprint, UTM,
              referrer and user agent. Disabled by default for new forms.
              Existing forms retain their previous setting; changing it does not
              erase saved data. Short-lived abuse protection continues without
              this metadata.
            </p>
            <div className="space-y-2">
              <Label htmlFor="intake-close">Closing time (UTC)</Label>
              <Input
                id="intake-close"
                type="datetime-local"
                step="1"
                value={policy.closesAt?.replace(/Z$/, "").slice(0, 19) ?? ""}
                onChange={(event) =>
                  change({
                    closesAt: event.target.value
                      ? new Date(`${event.target.value}Z`).toISOString()
                      : null,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="intake-max">Maximum accepted responses</Label>
              <Input
                id="intake-max"
                type="number"
                min="1"
                max="2147483647"
                value={policy.maxAccepted ?? ""}
                onChange={(event) =>
                  change({
                    maxAccepted: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
              />
            </div>
            <p className="text-sm text-slate-600 sm:col-span-2">
              {acceptedCount} responses accepted so far. Deletion does not free
              a place or return daily quota. Leave the time or maximum blank for
              no limit. Resume by clearing pause and any reached closing limits.
            </p>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="intake-message">Closed intake message</Label>
              <Textarea
                id="intake-message"
                required
                maxLength={500}
                value={policy.closedMessage}
                onChange={(event) =>
                  change({ closedMessage: event.target.value })
                }
              />
            </div>
            {canEdit ? (
              <Button type="submit" className="w-fit">
                {mutation.isPending ? "Saving…" : "Save intake settings"}
              </Button>
            ) : null}
          </fieldset>
          {mutation.error ? (
            <Alert className="mt-3">{mutation.error.message}</Alert>
          ) : null}
          {saved ? (
            <p role="status" className="mt-3 text-sm">
              Intake settings saved
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
};
