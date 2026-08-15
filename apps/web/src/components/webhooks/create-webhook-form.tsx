"use client";

import { Alert, Button, Input, Label } from "@form-forge/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { readApiData } from "@/lib/client-api";

export const CreateWebhookForm = ({
  disabled,
  formId,
  workspaceSlug,
}: {
  disabled: boolean;
  formId: string;
  workspaceSlug: string;
}) => {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setSecret(undefined);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}/webhooks`,
        {
          body: JSON.stringify({ name, url }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const created = await readApiData<{ secret: string }>(
        response,
        "Could not create endpoint",
      );
      setSecret(created.secret);
      setName("");
      setUrl("");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create endpoint",
      );
    } finally {
      setPending(false);
    }
  };

  if (disabled) {
    return (
      <Alert tone="info">
        Only workspace owners can create webhook endpoints.
      </Alert>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <div className="space-y-2">
        <Label htmlFor="endpoint-name">Endpoint name</Label>
        <Input
          id="endpoint-name"
          maxLength={120}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="endpoint-url">HTTPS URL</Label>
        <Input
          id="endpoint-url"
          placeholder="https://example.com/webhooks/form-forge"
          required
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {secret ? (
        <Alert tone="success">
          <p className="font-medium">Copy the signing secret now</p>
          <p className="mt-1 font-mono text-xs break-all">{secret}</p>
          <p className="mt-2 text-xs">It will not be shown again.</p>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending || !name.trim() || !url.trim()}>
        {pending ? "Creating…" : "Create endpoint"}
      </Button>
    </form>
  );
};
