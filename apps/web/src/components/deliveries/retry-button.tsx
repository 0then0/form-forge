"use client";

import { Button } from "@form-forge/ui";
import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const RetryButton = ({
  deliveryId,
  disabled,
  workspaceSlug,
}: {
  deliveryId: string;
  disabled: boolean;
  workspaceSlug: string;
}) => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const retry = async () => {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/deliveries/${deliveryId}/retry`,
        { method: "POST" },
      );
      const body = (await response.json()) as {
        error?: { message: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Retry failed");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retry failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <Button
        disabled={disabled || pending}
        size="sm"
        variant="secondary"
        onClick={() => void retry()}
      >
        <RefreshCcw className="size-3.5" />
        {pending ? "Queuing…" : "Retry"}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
};
