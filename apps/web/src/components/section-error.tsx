"use client";

import * as Sentry from "@sentry/nextjs";
import { Alert, Button } from "@form-forge/ui";
import { useEffect } from "react";

export const SectionError = ({
  description,
  error,
  reset,
  title,
}: {
  description: string;
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
}) => {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-16">
      <Alert>
        <h1 className="font-semibold">{title}</h1>
        <p className="mt-1">{description}</p>
        <Button className="mt-4" variant="secondary" onClick={reset}>
          Try again
        </Button>
      </Alert>
    </div>
  );
};
