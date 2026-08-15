"use client";

import { Badge, Button } from "@form-forge/ui";
import { Eye, Save, Send, Webhook } from "lucide-react";
import Link from "next/link";

export const EditorHeader = ({
  canPublish,
  canSave,
  dirty,
  formId,
  onPublish,
  onSave,
  publicSlug,
  published,
  publishing,
  saving,
  title,
  workspaceSlug,
}: {
  canPublish: boolean;
  canSave: boolean;
  dirty: boolean;
  formId: string;
  onPublish: () => void;
  onSave: () => void;
  publicSlug: string;
  published: boolean;
  publishing: boolean;
  saving: boolean;
  title: string;
  workspaceSlug: string;
}) => (
  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <Badge tone={published ? "success" : "neutral"}>
          {published ? "published" : "draft"}
        </Badge>
        {dirty ? <Badge tone="warning">unsaved</Badge> : null}
      </div>
      <p className="mt-1 text-sm text-slate-600">/f/{publicSlug}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary">
        <Link href={`/app/${workspaceSlug}/forms/${formId}/webhooks`}>
          <Webhook className="size-4" /> Webhooks
        </Link>
      </Button>
      {published ? (
        <Button asChild variant="secondary">
          <a href={`/f/${publicSlug}`} target="_blank" rel="noreferrer">
            <Eye className="size-4" /> Open form
          </a>
        </Button>
      ) : null}
      <Button disabled={!canSave} variant="secondary" onClick={onSave}>
        <Save className="size-4" />
        {saving ? "Saving…" : "Save draft"}
      </Button>
      <Button disabled={!canPublish} onClick={onPublish}>
        <Send className="size-4" />
        {publishing ? "Publishing…" : "Publish"}
      </Button>
    </div>
  </div>
);
