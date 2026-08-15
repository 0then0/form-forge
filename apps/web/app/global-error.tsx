"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main
          style={{
            fontFamily: "system-ui",
            padding: "4rem",
            textAlign: "center",
          }}
        >
          <h1>Form Forge could not load</h1>
          <p>
            Refresh the page. If the problem continues, contact the workspace
            owner.
          </p>
        </main>
      </body>
    </html>
  );
}
