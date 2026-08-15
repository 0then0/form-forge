"use client";

import { SectionError } from "@/components/section-error";

export default function DeliveriesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SectionError
      description="Delivery state could not be loaded. Active retries continue in the background."
      error={error}
      reset={reset}
      title="Deliveries unavailable"
    />
  );
}
