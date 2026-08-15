"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
} from "@form-forge/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { readApiData } from "@/lib/client-api";

type Endpoint = { enabled: boolean; id: string; name: string; url: string };

export const WebhookEndpointCard = ({
  canManage,
  endpoint,
  formId,
  workspaceSlug,
}: {
  canManage: boolean;
  endpoint: Endpoint;
  formId: string;
  workspaceSlug: string;
}) => {
  const router = useRouter();
  const [name, setName] = useState(endpoint.name);
  const [url, setUrl] = useState(endpoint.url);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<string>();
  const base = `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/webhooks/${endpoint.id}`;

  const request = async (path: string, init: RequestInit) => {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...init.headers },
      });
      const updated = await readApiData<{ secret?: string }>(
        response,
        "Webhook update failed",
      );
      if (updated.secret) setSecret(updated.secret);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Webhook update failed",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">{endpoint.name}</p>
          <Badge tone={endpoint.enabled ? "success" : "neutral"}>
            {endpoint.enabled ? "enabled" : "disabled"}
          </Badge>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`endpoint-name-${endpoint.id}`}>Name</Label>
          <Input
            id={`endpoint-name-${endpoint.id}`}
            disabled={!canManage || pending}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`endpoint-url-${endpoint.id}`}>HTTPS URL</Label>
          <Input
            id={`endpoint-url-${endpoint.id}`}
            disabled={!canManage || pending}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {secret ? (
          <Alert tone="success">
            <p className="font-medium">Copy the new secret now</p>
            <p className="mt-1 font-mono text-xs break-all">{secret}</p>
          </Alert>
        ) : null}
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || !name.trim() || !url.trim()}
              size="sm"
              variant="secondary"
              onClick={() =>
                void request(base, {
                  body: JSON.stringify({ name, url }),
                  method: "PATCH",
                })
              }
            >
              Save
            </Button>
            <Button
              disabled={pending}
              size="sm"
              variant="secondary"
              onClick={() =>
                void request(base, {
                  body: JSON.stringify({ enabled: !endpoint.enabled }),
                  method: "PATCH",
                })
              }
            >
              {endpoint.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              disabled={pending}
              size="sm"
              variant="secondary"
              onClick={() =>
                window.confirm(
                  "Rotate this signing secret? The old secret will stop working immediately.",
                ) && void request(`${base}/rotate-secret`, { method: "POST" })
              }
            >
              Rotate secret
            </Button>
            <Button
              disabled={pending}
              size="sm"
              variant="danger"
              onClick={() =>
                window.confirm(
                  "Archive this endpoint? New submissions will no longer be sent to it.",
                ) && void request(base, { method: "DELETE" })
              }
            >
              Archive
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
