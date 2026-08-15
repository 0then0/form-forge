"use client";

import { SectionError } from "@/components/section-error";

export default function SubmissionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SectionError
      description="Submission data could not be loaded. No records were changed."
      error={error}
      reset={reset}
      title="Submissions unavailable"
    />
  );
}
