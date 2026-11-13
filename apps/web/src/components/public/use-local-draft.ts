"use client";

import {
  normalizeSubmission,
  sanitizePartialAnswers,
  type FormSchemaV1,
  type NormalizedSubmission,
  type SubmissionContext,
} from "@form-forge/form-schema";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DRAFT_TTL_MS,
  discoverLocalDrafts,
  localDraftKey,
  readLocalDraft,
  removeLocalDraft,
  writeLocalDraft,
  type LocalDraftIdentity,
  type LocalDraftRecord,
  type LocalSubmissionAttempt,
} from "./local-draft";
import {
  attemptDigest,
  clearSessionAttempt,
  readSessionAttempt,
  rememberSessionAttempt,
} from "./submission-attempt";

const storageMessage =
  "Local storage is unavailable or full. Your latest changes are not saved. You can turn off saving and continue filling out this form.";
const changedAttemptMessage =
  "Retry the original attempt or explicitly start a new attempt before submitting changed answers.";

export const useLocalDraft = (
  schema: FormSchemaV1,
  slug: string,
  versionId: string,
) => {
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState<LocalDraftRecord | null>(null);
  const [incompatible, setIncompatible] = useState<LocalDraftRecord[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState<LocalSubmissionAttempt>();
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [restoreAnswers, setRestoreAnswers] = useState<{
    revision: string;
    answers: NormalizedSubmission;
  }>();
  const identity = useRef<LocalDraftIdentity>({ origin: "", slug, versionId });
  const writerId = useRef(crypto.randomUUID());
  const current = useRef<LocalDraftRecord | null>(null);
  const answers = useRef<NormalizedSubmission>({});
  const attemptRef = useRef<LocalSubmissionAttempt | undefined>(undefined);
  const active = useRef(false);
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const uncertain = useRef(false);

  const cancel = useCallback(() => {
    generation.current += 1;
    clearTimeout(timer.current);
    timer.current = undefined;
    setSaving(false);
  }, []);
  const updateAttempt = useCallback((value?: LocalSubmissionAttempt) => {
    attemptRef.current = value;
    setAttempt(value);
  }, []);
  const pause = useCallback(() => {
    cancel();
    paused.current = true;
    setConflict(true);
  }, [cancel]);

  const persist = useCallback(() => {
    if (!active.current || paused.current) return false;
    const now = Date.now();
    const previous = current.current;
    const record: LocalDraftRecord = {
      ...identity.current,
      formatVersion: 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + DRAFT_TTL_MS,
      revision: crypto.randomUUID(),
      writerId: writerId.current,
      answers: sanitizePartialAnswers(schema, answers.current).answers,
      ...(attemptRef.current ? { attempt: attemptRef.current } : {}),
    };
    try {
      writeLocalDraft(record, previous?.revision ?? null);
      current.current = record;
      setSavedAt(now);
      setSaving(false);
      setError(undefined);
      return true;
    } catch {
      // Re-read before classifying: a revision change is a conflict, not a
      // quota error. Neither case may silently overwrite another tab.
      try {
        if (readLocalDraft(identity.current)?.revision !== previous?.revision) {
          pause();
          return false;
        }
      } catch {
        // Storage denial is reported below without exposing stored values.
      }
      setSaving(false);
      setError(storageMessage);
      return false;
    }
  }, [pause, schema]);

  useEffect(() => {
    identity.current = { origin: window.location.origin, slug, versionId };
    try {
      const discovered = discoverLocalDrafts(identity.current);
      setPending(discovered.current);
      setIncompatible(discovered.incompatible);
      // Discovery may be replayed in React StrictMode after its cleanup has
      // already removed damaged/expired records. Keep the first explanation.
      if (discovered.notices.length) setNotice(discovered.notices.join(" "));
    } catch {
      setError(storageMessage);
    }
    const reconcile = (event?: StorageEvent) => {
      if (
        event &&
        event.key !== null &&
        event.key !== localDraftKey(identity.current)
      )
        return;
      try {
        const latest = readLocalDraft(identity.current);
        // A delayed event from a competing writer is still a conflict even
        // when our later write is currently the last value in localStorage.
        const externalChange =
          event && event.newValue !== JSON.stringify(current.current);
        if (!externalChange && latest?.revision === current.current?.revision)
          return;
        if (active.current || current.current) {
          pause();
          if (!latest) {
            // Discard/success elsewhere invalidates the retry binding too.
            uncertain.current ||= Boolean(attemptRef.current);
            updateAttempt(undefined);
          }
        } else {
          setPending(latest);
        }
      } catch {
        cancel();
        setError(storageMessage);
      }
    };
    const onFocus = () => reconcile();
    window.addEventListener("storage", reconcile);
    window.addEventListener("focus", onFocus);
    // Flush only an already-consented draft. A synchronous localStorage write
    // is best effort on page exit; the UI confirms only completed writes.
    const flush = () => {
      if (timer.current !== undefined) {
        cancel();
        persist();
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(timer.current);
      generation.current += 1;
      window.removeEventListener("storage", reconcile);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", flush);
    };
  }, [cancel, pause, persist, slug, updateAttempt, versionId]);

  const onAnswersChange = useCallback(
    (value: NormalizedSubmission) => {
      answers.current = value;
      if (!active.current || paused.current) return;
      cancel();
      setSaving(true);
      const revision = generation.current;
      timer.current = setTimeout(() => {
        timer.current = undefined;
        if (
          revision === generation.current &&
          active.current &&
          !paused.current
        )
          persist();
      }, 400);
    },
    [cancel, persist],
  );

  const toggle = (value: boolean) => {
    cancel();
    if (value) {
      active.current = true;
      paused.current = false;
      if (persist()) setEnabled(true);
      else active.current = false;
    } else {
      active.current = false;
      setEnabled(false);
      setSavedAt(undefined);
      try {
        removeLocalDraft(identity.current, current.current?.revision ?? null);
        current.current = null;
        setError(undefined);
      } catch {
        setError(
          "The saved response could not be removed. Local storage may be unavailable or another tab changed it.",
        );
      }
    }
  };

  const adopt = (record: LocalDraftRecord) => {
    const sanitized = sanitizePartialAnswers(schema, record.answers);
    // An attempt must survive exactly or be rejected as a whole. Never turn a
    // damaged retry into a fresh submission with silently repaired values.
    if (record.attempt) {
      const normalized = normalizeSubmission(schema, record.attempt.values);
      if (
        !normalized.success ||
        JSON.stringify(normalized.receivedValues) !==
          JSON.stringify(record.attempt.values)
      ) {
        setError(
          "The saved submission attempt is incompatible with this schema. It was not restored. Discard it to continue.",
        );
        return;
      }
    }
    cancel();
    current.current = record;
    answers.current = sanitized.answers;
    updateAttempt(record.attempt);
    setRestoreAnswers({
      revision: crypto.randomUUID(),
      answers: sanitized.answers,
    });
    setNotice(
      sanitized.droppedKeys.length
        ? "Some saved answers were invalid or hidden and were omitted. Review the form before submitting."
        : undefined,
    );
    active.current = true;
    paused.current = false;
    setEnabled(true);
    setConflict(false);
    setPending(null);
    setSavedAt(record.updatedAt);
    setError(undefined);
    setConfirmNew(false);
    setConfirmDiscard(false);
    uncertain.current = false;
  };

  const resume = () => {
    try {
      const latest = readLocalDraft(identity.current);
      if (latest) adopt(latest);
      else {
        cancel();
        current.current = null;
        active.current = false;
        paused.current = false;
        uncertain.current ||= Boolean(attemptRef.current);
        updateAttempt(undefined);
        setEnabled(false);
        setConflict(false);
        setPending(null);
        setSavedAt(undefined);
        setNotice("The saved response was removed or expired in another tab.");
      }
    } catch {
      setError(storageMessage);
    }
  };
  const performDiscard = () => {
    cancel();
    active.current = false;
    setEnabled(false);
    try {
      const latest = readLocalDraft(identity.current);
      if (latest)
        removeLocalDraft(
          identity.current,
          pending?.revision ?? current.current?.revision ?? null,
        );
      current.current = null;
      updateAttempt(undefined);
      clearSessionAttempt(slug, versionId);
      setPending(null);
      setConflict(false);
      paused.current = false;
      setSavedAt(undefined);
      setError(undefined);
      setConfirmNew(false);
      setConfirmDiscard(false);
      uncertain.current = false;
    } catch {
      setError(
        "The saved response could not be removed. Local storage may be unavailable or another tab changed it. Choose Use saved answers to inspect the current revision.",
      );
    }
  };

  const discard = () => {
    if (pending?.attempt || attemptRef.current || uncertain.current) {
      setConfirmDiscard(true);
      return;
    }
    performDiscard();
  };

  const prepareAttempt = async (
    values: NormalizedSubmission,
    context?: SubmissionContext,
  ) => {
    if (paused.current || pending)
      throw new Error("Resolve the saved response before submitting.");
    if (uncertain.current) {
      setConfirmNew(true);
      throw new Error(changedAttemptMessage);
    }
    const existing = attemptRef.current;
    if (existing) {
      if (JSON.stringify(existing.values) !== JSON.stringify(values))
        throw new Error(changedAttemptMessage);
      if (active.current) {
        cancel();
        if (!persist())
          throw new Error(
            "The retry could not be saved. Resolve the storage error before retrying.",
          );
      }
      return existing;
    }
    const preparedGeneration = generation.current;
    const digest = await attemptDigest(versionId, values);
    if (preparedGeneration !== generation.current || paused.current)
      throw new Error(
        "The form changed while preparing the attempt. Please try again.",
      );
    const session = readSessionAttempt(slug, versionId);
    if (session.unknown || (session.digest && session.digest !== digest)) {
      setConfirmNew(true);
      throw new Error(changedAttemptMessage);
    }
    const created: LocalSubmissionAttempt = {
      key: session.key,
      versionId,
      values: structuredClone(values),
      ...(context ? { context } : {}),
    };
    updateAttempt(created);
    rememberSessionAttempt(slug, versionId, created.key, digest);
    if (active.current) {
      cancel();
      if (!persist())
        throw new Error(
          "The submission attempt could not be saved. Turn off saving to submit without reload recovery, then try again.",
        );
    }
    return created;
  };

  const complete = () => {
    const completedAttempt = attemptRef.current;
    cancel();
    active.current = false;
    setEnabled(false);
    updateAttempt(undefined);
    clearSessionAttempt(slug, versionId);
    try {
      const latest = current.current ? readLocalDraft(identity.current) : null;
      // Another tab may have edited answers while this request was in flight.
      // A record still bound to this successful attempt must be invalidated,
      // including its newer answers revision. A deliberately new attempt has
      // a different key and belongs to a separate response.
      if (
        latest &&
        (latest.revision === current.current?.revision ||
          (completedAttempt && latest.attempt?.key === completedAttempt.key))
      )
        removeLocalDraft(identity.current, latest.revision);
      current.current = null;
      setError(undefined);
    } catch {
      setError(
        "Your response was sent, but its local copy could not be removed. Remove saved site data on this device when storage becomes available.",
      );
    }
  };
  const validationRejected = () => {
    updateAttempt(undefined);
    clearSessionAttempt(slug, versionId);
    if (active.current) persist();
  };
  const newAttempt = () => {
    cancel();
    if (paused.current) {
      try {
        current.current = readLocalDraft(identity.current);
      } catch {
        setError(storageMessage);
        return;
      }
      paused.current = false;
      setConflict(false);
    }
    updateAttempt(undefined);
    clearSessionAttempt(slug, versionId);
    uncertain.current = false;
    setConfirmNew(false);
    if (active.current) persist();
  };
  const keepMine = () => {
    try {
      const latest = readLocalDraft(identity.current);
      if (latest?.attempt || attemptRef.current || uncertain.current) {
        setConfirmNew(true);
        return;
      }
      current.current = latest;
      paused.current = false;
      active.current = true;
      setConflict(false);
      if (persist()) setEnabled(true);
    } catch {
      setError(storageMessage);
    }
  };
  const deleteIncompatible = () => {
    try {
      for (const record of incompatible)
        removeLocalDraft(record, record.revision);
      setIncompatible([]);
    } catch {
      setError(storageMessage);
    }
  };

  return {
    enabled,
    pending,
    incompatible,
    notice,
    error,
    savedAt,
    saving,
    conflict,
    attempt,
    confirmNew,
    confirmDiscard,
    setConfirmDiscard,
    restoreAnswers,
    onAnswersChange,
    toggle,
    resume,
    discard,
    performDiscard,
    keepMine,
    deleteIncompatible,
    prepareAttempt,
    complete,
    validationRejected,
    setConfirmNew,
    newAttempt,
  };
};
