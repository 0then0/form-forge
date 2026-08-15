"use client";

import { SectionError } from "@/components/section-error";

export default function FormEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SectionError
      description="The editor or schema preview could not be loaded. Your last saved draft is unchanged."
      error={error}
      reset={reset}
      title="Form editor unavailable"
    />
  );
}
