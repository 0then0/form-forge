"use client";

import { Button } from "@form-forge/ui";
import { Archive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const ArchiveFormButton = ({
  disabled,
  formId,
  workspaceSlug,
}: {
  disabled: boolean;
  formId: string;
  workspaceSlug: string;
}) => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const archiveForm = async () => {
    if (
      !window.confirm(
        "Archive this form? Its hosted page will stop accepting submissions.",
      )
    ) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/forms/${formId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Form could not be archived");
      router.push(`/app/${workspaceSlug}/forms`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Form could not be archived",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <Button
        disabled={disabled || pending}
        size="sm"
        variant="danger"
        onClick={() => void archiveForm()}
      >
        <Archive className="size-3.5" />{" "}
        {pending ? "Archiving…" : "Archive form"}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
};
