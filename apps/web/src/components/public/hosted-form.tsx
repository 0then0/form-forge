"use client";

import {
  FormRenderer,
  FormSubmissionError,
  rendererMessages,
} from "@form-forge/form-renderer";
import {
  DEFAULT_FORM_LANGUAGE,
  formatSubmissionIssue,
  type FormLanguage,
  type FormSchemaV1,
  type NormalizedSubmission,
  type SubmissionContext,
} from "@form-forge/form-schema";
import { Button, Card, CardContent } from "@form-forge/ui";
import { CheckCircle2 } from "lucide-react";
import { useRef, useState } from "react";

import { webRendererComponents } from "@/components/renderer-adapter";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEmbedBridge } from "./use-embed-bridge";
import { ClientApiError, readApiData } from "@/lib/client-api";
import { getPublicFormMessages } from "@/lib/public-form-messages";
import { useLocalDraft } from "./use-local-draft";
import type { LocalSubmissionAttempt } from "./local-draft";

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
  collectMetadata = false,
  closedMessage,
  schema,
  slug,
  versionId,
}: {
  compact?: boolean;
  collectMetadata?: boolean;
  closedMessage?: string | undefined;
  schema: FormSchemaV1;
  slug: string;
  versionId: string;
}) => {
  const language = schema.settings.language ?? DEFAULT_FORM_LANGUAGE;
  const messages = getPublicFormMessages(language);
  const [submitted, setSubmitted] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const draft = useLocalDraft(schema, slug, versionId);
  const embedRoot = useEmbedBridge(compact, submitted);

  const send = async (attempt: LocalSubmissionAttempt) => {
    const response = await fetch(`/api/forms/${slug}/submit`, {
      body: JSON.stringify({
        ...(attempt.context ? { context: attempt.context } : {}),
        values: attempt.values,
        versionId: attempt.versionId,
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": attempt.key,
      },
      method: "POST",
    });
    const fallback = rendererMessages[language].submissionFailed;
    try {
      await readApiData<{ submissionId: string }>(response, fallback);
    } catch (error) {
      // These responses definitively reject the request before committing it.
      // Leave transport/server failures bound to their original payload/key.
      if (response.status === 400 || response.status === 422)
        draft.validationRejected();
      if (!(error instanceof ClientApiError))
        throw new FormSubmissionError(fallback);
      const details = error.submissionDetails;
      if (response.status === 409 && details?.closedIntake) {
        throw new FormSubmissionError(
          details.closedIntake.customMessage ?? messages.closed,
        );
      }
      if (error.code === "RATE_LIMITED")
        throw new FormSubmissionError(messages.rateLimited);
      if (error.code === "NOT_FOUND")
        throw new FormSubmissionError(messages.unavailable);
      const fieldErrors =
        details?.fieldIssues &&
        Object.fromEntries(
          Object.entries(details.fieldIssues).map(([field, issues]) => [
            field,
            issues.map((issue) => formatSubmissionIssue(issue, language)),
          ]),
        );
      throw new FormSubmissionError(fallback, fieldErrors);
    }
    draft.complete();
    setSubmitted(true);
  };
  const submit = async (values: NormalizedSubmission) => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setRetryError(undefined);
    try {
      const attempt = await draft.prepareAttempt(
        values,
        collectMetadata ? getContext() : undefined,
      );
      await send(attempt);
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  const retry = async () => {
    if (!draft.attempt || busy.current) return;
    try {
      await submit(draft.attempt.values);
    } catch (error) {
      setRetryError(
        error instanceof FormSubmissionError
          ? Object.values(error.fieldErrors ?? {})
              .flat()
              .join(". ") || error.message
          : messages.retryFailed,
      );
    }
  };
  const draftControls = (
    <LocalDraftControls
      draft={draft}
      closed={Boolean(closedMessage)}
      language={language}
      sending={sending}
      retry={() => void retry()}
    />
  );

  const content = closedMessage ? (
    <div role="status">
      <h1 className="text-2xl font-semibold">{schema.title}</h1>
      <p className="mt-4">{closedMessage}</p>
      {draftControls}
    </div>
  ) : submitted ? (
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
      {draftControls}
      {retryError ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {retryError}
        </p>
      ) : null}
      <div className="[&_form>button]:mt-7 [&_form>[data-form-fields]]:grid [&_form>[data-form-fields]]:gap-5 [&_form>[data-form-fields]]:sm:grid-cols-2">
        <FormRenderer
          components={webRendererComponents}
          schema={schema}
          onSubmit={submit}
          disabled={Boolean(draft.pending) || draft.conflict || sending}
          restoreAnswers={draft.restoreAnswers}
          onAnswersChange={draft.onAnswersChange}
        />
      </div>
    </>
  );

  if (compact)
    return (
      <div lang={language} ref={embedRoot} className="bg-white p-5">
        {content}
        {submitted && draft.error ? <p role="alert">{draft.error}</p> : null}
      </div>
    );
  return (
    <main
      lang={language}
      className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12 sm:px-6"
    >
      <ThemeToggle
        className="fixed top-4 right-4 sm:top-6 sm:right-6"
        labels={messages.theme}
      />
      <div className="w-full">
        <Card>
          <CardContent className="p-6 sm:p-8">
            {content}
            {submitted && draft.error ? (
              <p role="alert">{draft.error}</p>
            ) : null}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">
          {messages.poweredBy}{" "}
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

const LocalDraftControls = ({
  draft,
  closed,
  language,
  sending,
  retry,
}: {
  draft: ReturnType<typeof useLocalDraft>;
  closed: boolean;
  language: FormLanguage;
  sending: boolean;
  retry: () => void;
}) => {
  const messages = getPublicFormMessages(language);
  return (
    <section
      aria-label={messages.savedResponse}
      className="my-5 space-y-3 rounded-md border border-slate-200 p-4 text-sm"
    >
      {draft.error ? (
        <p role="alert" className="text-red-700">
          {draft.error}
        </p>
      ) : null}
      {draft.notice ? <p role="status">{draft.notice}</p> : null}
      {draft.incompatible.length ? (
        <div className="space-y-2">
          <p>{messages.incompatible}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={sending}
            onClick={draft.deleteIncompatible}
          >
            {messages.deleteIncompatible}
          </Button>
        </div>
      ) : null}
      {draft.pending ? (
        <div className="space-y-2">
          <p>
            {messages.pending(
              new Date(draft.pending.updatedAt).toLocaleString(language),
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={draft.resume}
              disabled={closed || sending}
            >
              {messages.resume}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={draft.discard}
              disabled={sending}
            >
              {messages.discard}
            </Button>
          </div>
        </div>
      ) : draft.conflict ? (
        <div className="space-y-2">
          <p role="alert">{messages.tabConflict}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={draft.resume}
              disabled={closed || sending}
            >
              {messages.useSaved}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={draft.keepMine}
              disabled={closed || sending}
            >
              {messages.keepMine}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={draft.discard}
              disabled={sending}
            >
              {messages.discard}
            </Button>
          </div>
        </div>
      ) : !closed ? (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={sending}
              onChange={(event) => draft.toggle(event.currentTarget.checked)}
              className="size-4 accent-slate-950"
            />
            {messages.saveOnDevice}
          </label>
          <p className="text-slate-600">{messages.savingDescription}</p>
          {draft.enabled ? (
            <>
              <p role="status">
                {draft.saving
                  ? messages.savingChanges
                  : draft.savedAt
                    ? messages.savedAt(
                        new Date(draft.savedAt).toLocaleString(language),
                      )
                    : messages.savingActive}
              </p>
              <p className="text-slate-600">{messages.savingConfirmation}</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={draft.discard}
                disabled={sending}
              >
                {messages.deleteSaved}
              </Button>
            </>
          ) : null}
        </>
      ) : null}
      {draft.attempt && !closed && !sending ? (
        <div className="space-y-2">
          <p role="alert">{messages.unknownOutcome}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={sending || draft.conflict}
              onClick={retry}
            >
              {messages.retryOriginal}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={sending}
              onClick={() => draft.setConfirmNew(true)}
            >
              {messages.startNew}
            </Button>
          </div>
        </div>
      ) : null}
      {draft.confirmDiscard ? (
        <div className="space-y-2">
          <p role="alert">{messages.discardWarning}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={sending}
              onClick={draft.performDiscard}
            >
              {messages.confirmDiscard}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => draft.setConfirmDiscard(false)}
            >
              {messages.cancelDiscard}
            </Button>
          </div>
        </div>
      ) : null}
      {draft.confirmNew ? (
        <div className="space-y-2">
          <p role="alert">{messages.newAttemptWarning}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={sending || closed}
              onClick={draft.newAttempt}
            >
              {messages.confirmNew}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => draft.setConfirmNew(false)}
            >
              {messages.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
};
