"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@form-forge/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { readApiData } from "@/lib/client-api";

export const CreateFormButton = ({
  disabled,
  workspaceSlug,
}: {
  disabled: boolean;
  workspaceSlug: string;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms`,
        {
          body: JSON.stringify({ name }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const created = await readApiData<{ id: string }>(
        response,
        "Could not create the form",
      );
      setOpen(false);
      router.push(`/app/${workspaceSlug}/forms/${created.id}`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create the form",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Plus className="size-4" /> New form
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Create a form</DialogTitle>
        <DialogDescription>
          Start with an empty draft and add fields in the schema editor.
        </DialogDescription>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <div className="space-y-2">
            <Label htmlFor="form-name">Name</Label>
            <Input
              id="form-name"
              maxLength={160}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error === undefined ? null : (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending ? "Creating…" : "Create form"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
