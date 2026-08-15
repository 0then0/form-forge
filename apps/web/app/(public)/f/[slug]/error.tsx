"use client";

import { Button } from "@form-forge/ui";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function HostedFormError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">The form could not load</h1>
        <p className="mt-2 text-slate-600">
          Your response has not been submitted.
        </p>
        <Button className="mt-5" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
