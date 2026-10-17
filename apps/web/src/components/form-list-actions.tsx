"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
} from "@form-forge/ui";
import { Eye, ExternalLink, RotateCcw, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readApiData } from "@/lib/client-api";

export const FormListActions = ({
  form,
  workspaceSlug,
  canEdit,
  canDelete,
}: {
  form: {
    id: string;
    name: string;
    slug: string;
    status: string;
    updatedAt: string;
  };
  workspaceSlug: string;
  canEdit: boolean;
  canDelete: boolean;
}) => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const mutate = async (action: "publish" | "restore" | "permanent") => {
    if (
      action !== "permanent" &&
      !window.confirm(
        action === "publish"
          ? `Publish the saved draft of “${form.name}”?`
          : `Restore “${form.name}”? Previously published forms will accept submissions again.`,
      )
    )
      return;
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms/${form.id}/${action}`,
        {
          method: action === "permanent" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          ...(action === "restore"
            ? {}
            : {
                body: JSON.stringify(
                  action === "publish"
                    ? { expectedRevision: form.updatedAt }
                    : { confirmation },
                ),
              }),
        },
      );
      await readApiData(response, "Could not update the form");
      setDeleting(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update the form",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {form.status === "published" ? (
          <Button asChild variant="secondary" size="sm">
            <Link
              href={`/f/${form.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" /> View
            </Link>
          </Button>
        ) : form.status === "draft" ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!canEdit || pending}
            onClick={() => void mutate("publish")}
          >
            <Send className="size-4" />
            {pending ? "Publishing…" : "Publish"}
          </Button>
        ) : (
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/app/${workspaceSlug}/forms/${form.id}`}>
                <Eye className="size-4" /> View
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canEdit || pending}
              onClick={() => void mutate("restore")}
            >
              <RotateCcw className="size-4" />
              {pending ? "Restoring…" : "Restore"}
            </Button>
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setError(undefined);
                  setDeleting(true);
                }}
              >
                <Trash2 className="size-4 text-red-600" /> Delete permanently
              </Button>
            ) : null}
          </>
        )}
      </div>
      {error && !deleting ? (
        <p role="alert" className="max-w-sm text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Dialog
        open={deleting}
        onOpenChange={(open) => {
          if (!pending) {
            setDeleting(open);
            setConfirmation("");
          }
        }}
      >
        <DialogContent>
          <DialogTitle>Delete form permanently?</DialogTitle>
          <DialogDescription>
            This permanently deletes “{form.name}”, all submissions, versions,
            webhook endpoints and delivery history. This cannot be undone.
          </DialogDescription>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (confirmation === form.name) void mutate("permanent");
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={`delete-${form.id}`}>
                Type the form name to confirm
              </Label>
              <Input
                id={`delete-${form.id}`}
                value={confirmation}
                disabled={pending}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setDeleting(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={pending || confirmation !== form.name}
              >
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
