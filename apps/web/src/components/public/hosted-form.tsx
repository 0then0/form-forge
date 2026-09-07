"use client";

import { FormRenderer } from "@form-forge/form-renderer";
import type {
  FormSchemaV1,
  NormalizedSubmission,
  SubmissionContext,
} from "@form-forge/form-schema";
import { Card, CardContent } from "@form-forge/ui";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { webRendererComponents } from "@/components/renderer-adapter";
import { ThemeToggle } from "@/components/theme-toggle";
import { readApiData } from "@/lib/client-api";

const utmKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

const getVisitorId = (): string | undefined => {
  try {
    const key = "form-forge-visitor-id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return undefined;
  }
};

const getSubmissionIdempotencyKey = (
  slug: string,
  versionId: string,
): string => {
  const key = submissionIdempotencyStorageKey(slug, versionId);
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
};

const submissionIdempotencyStorageKey = (slug: string, versionId: string) =>
  `form-forge-submission:${slug}:${versionId}`;

const clearSubmissionIdempotencyKey = (slug: string, versionId: string) => {
  try {
    window.sessionStorage.removeItem(
      submissionIdempotencyStorageKey(slug, versionId),
    );
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
};

const getContext = (): SubmissionContext => {
  const params = new URLSearchParams(window.location.search);
  const utm = Object.fromEntries(
    utmKeys.flatMap((key) => {
      const value = params.get(key);
      return value === null ? [] : [[key, value]];
    }),
  );
  const referrer = document.referrer;
  const visitorId = getVisitorId();
  return {
    ...(referrer ? { referrer } : {}),
    utm,
    ...(visitorId ? { visitorId } : {}),
  };
};

export const HostedForm = ({
  compact = false,
  schema,
  slug,
  versionId,
}: {
  compact?: boolean;
  schema: FormSchemaV1;
  slug: string;
  versionId: string;
}) => {
  // Keep retries safe after a refresh without turning a browser-wide key into
  // a cross-form identifier. A new browser session intentionally gets a new
  // key and can submit a new response.
  const [idempotencyKey] = useState(() =>
    typeof window === "undefined"
      ? crypto.randomUUID()
      : getSubmissionIdempotencyKey(slug, versionId),
  );
  const [submitted, setSubmitted] = useState(false);

  const submit = async (values: NormalizedSubmission) => {
    const response = await fetch(`/api/forms/${slug}/submit`, {
      body: JSON.stringify({ context: getContext(), values, versionId }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    });
    await readApiData<{ submissionId: string }>(
      response,
      "Your response could not be submitted",
    );
    clearSubmissionIdempotencyKey(slug, versionId);
    setSubmitted(true);
  };

  const content = submitted ? (
    <div role="status" className="py-8 text-center">
      <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
      <h1 className="mt-4 text-2xl font-semibold">
        {schema.settings.successTitle}
      </h1>
      <p className="mt-2 text-slate-600">{schema.settings.successMessage}</p>
    </div>
  ) : (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{schema.title}</h1>
      {schema.description ? (
        <p className="mt-2 mb-7 text-slate-600">{schema.description}</p>
      ) : (
        <div className="mb-7" />
      )}
      <div className="[&_form>button]:mt-7 [&_form>div]:grid [&_form>div]:gap-5 [&_form>div]:sm:grid-cols-2">
        <FormRenderer
          components={webRendererComponents}
          schema={schema}
          onSubmit={submit}
        />
      </div>
    </>
  );

  if (compact) return <div className="bg-white p-5">{content}</div>;
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12 sm:px-6">
      <ThemeToggle className="fixed top-4 right-4 sm:top-6 sm:right-6" />
      <div className="w-full">
        <Card>
          <CardContent className="p-6 sm:p-8">{content}</CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">
          Powered by{" "}
          <a
            className="font-medium hover:underline"
            href="https://github.com/0then0/form-forge"
            rel="noreferrer"
            target="_blank"
          >
            Form Forge
          </a>
        </p>
      </div>
    </main>
  );
};
