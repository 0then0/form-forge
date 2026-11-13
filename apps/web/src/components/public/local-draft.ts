import {
  MAX_LONG_TEXT_LENGTH,
  MAX_SUBMISSION_FIELDS,
  MAX_SUBMISSION_TEXT_LENGTH,
  submissionContextSchema,
  type NormalizedSubmission,
  type SubmissionContext,
} from "@form-forge/form-schema";

export const LOCAL_DRAFT_PREFIX = "form-forge-draft:";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_DRAFT_RECORD_BYTES = 256 * 1_024;
export const MAX_DRAFT_RECORDS = 10;

export type LocalDraftIdentity = {
  origin: string;
  slug: string;
  versionId: string;
};

type DraftAnswers = NormalizedSubmission;

export type LocalSubmissionAttempt = {
  key: string;
  versionId: string;
  values: NormalizedSubmission;
  context?: SubmissionContext | undefined;
};

export type LocalDraftRecord = LocalDraftIdentity & {
  formatVersion: 1;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  revision: string;
  writerId: string;
  answers: DraftAnswers;
  attempt?: LocalSubmissionAttempt | undefined;
};

export class LocalDraftStorageError extends Error {
  constructor(
    message = "Local saving is unavailable. You can continue filling in the form.",
  ) {
    super(message);
    this.name = "LocalDraftStorageError";
  }
}

export class LocalDraftConflictError extends Error {
  constructor() {
    super(
      "Saved answers changed in another tab. Choose how to continue before saving.",
    );
    this.name = "LocalDraftConflictError";
  }
}

export const localDraftKey = ({
  origin,
  slug,
  versionId,
}: LocalDraftIdentity) =>
  `${LOCAL_DRAFT_PREFIX}${encodeURIComponent(origin)}:${encodeURIComponent(slug)}:${encodeURIComponent(versionId)}`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const isAnswers = (value: unknown): value is DraftAnswers => {
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_SUBMISSION_FIELDS) return false;
  let textLength = 0;
  for (const [key, answer] of entries) {
    if (key.length === 0 || key.length > 64) return false;
    if (typeof answer === "string") {
      if (answer.length > MAX_LONG_TEXT_LENGTH) return false;
      textLength += answer.length;
    } else if (
      typeof answer !== "boolean" &&
      !(typeof answer === "number" && Number.isFinite(answer))
    ) {
      return false;
    }
  }
  return textLength <= MAX_SUBMISSION_TEXT_LENGTH;
};

const isRecord = (value: unknown): value is LocalDraftRecord => {
  if (!isObject(value) || value.formatVersion !== 1) return false;
  if (
    !isIdentifier(value.origin) ||
    !isIdentifier(value.slug) ||
    !isIdentifier(value.versionId) ||
    !isIdentifier(value.revision) ||
    !isIdentifier(value.writerId) ||
    !isAnswers(value.answers)
  ) {
    return false;
  }
  try {
    if (new URL(value.origin).origin !== value.origin) return false;
  } catch {
    return false;
  }
  if (
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.createdAt < 0 ||
    value.updatedAt < value.createdAt ||
    value.expiresAt <= value.updatedAt ||
    value.expiresAt > value.updatedAt + DRAFT_TTL_MS
  ) {
    return false;
  }
  if (value.attempt !== undefined) {
    const attempt = value.attempt;
    if (
      !isObject(attempt) ||
      !isIdentifier(attempt.key) ||
      attempt.versionId !== value.versionId ||
      !isAnswers(attempt.values) ||
      (attempt.context !== undefined &&
        !submissionContextSchema.safeParse(attempt.context).success)
    ) {
      return false;
    }
  }
  return true;
};

type DecodedDraft =
  | { record: LocalDraftRecord; notice?: never }
  | { record?: never; notice: string };

const decodeDraft = (raw: string, key: string, now: number): DecodedDraft => {
  if (new Blob([raw]).size > MAX_DRAFT_RECORD_BYTES) {
    return { notice: "An oversized saved draft was removed." };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { notice: "A damaged saved draft was removed." };
  }
  if (isObject(value) && value.formatVersion !== 1) {
    return {
      notice: "A saved draft used an unsupported format and was removed.",
    };
  }
  if (!isRecord(value) || localDraftKey(value) !== key) {
    return { notice: "A damaged saved draft was removed." };
  }
  if (value.expiresAt <= now) {
    return { notice: "An expired saved draft was removed after seven days." };
  }
  return { record: value };
};

// Accessing window.localStorage itself can throw in restricted iframe contexts.
const withStorage = <T>(
  operation: (storage: Storage) => T,
  supplied?: Storage,
): T => {
  try {
    return operation(supplied ?? window.localStorage);
  } catch (error) {
    if (
      error instanceof LocalDraftStorageError ||
      error instanceof LocalDraftConflictError
    ) {
      throw error;
    }
    throw new LocalDraftStorageError();
  }
};

const ownKeys = (storage: Storage): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LOCAL_DRAFT_PREFIX)) keys.push(key);
  }
  return keys;
};

export const discoverLocalDrafts = (
  identity: LocalDraftIdentity,
  suppliedStorage?: Storage,
  now = Date.now(),
): {
  current: LocalDraftRecord | null;
  incompatible: LocalDraftRecord[];
  notices: string[];
} =>
  withStorage((storage) => {
    let current: LocalDraftRecord | null = null;
    const incompatible: LocalDraftRecord[] = [];
    const notices = new Set<string>();
    for (const key of ownKeys(storage)) {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const decoded = decodeDraft(raw, key, now);
      if (decoded.notice !== undefined) {
        storage.removeItem(key);
        notices.add(decoded.notice);
        continue;
      }
      const record = decoded.record;
      if (record.origin !== identity.origin || record.slug !== identity.slug)
        continue;
      if (record.versionId === identity.versionId) current = record;
      else incompatible.push(record);
    }
    return { current, incompatible, notices: [...notices] };
  }, suppliedStorage);

export const readLocalDraft = (
  identity: LocalDraftIdentity,
  suppliedStorage?: Storage,
  now = Date.now(),
): LocalDraftRecord | null =>
  withStorage((storage) => {
    const key = localDraftKey(identity);
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const decoded = decodeDraft(raw, key, now);
    if (decoded.notice !== undefined) {
      throw new LocalDraftStorageError(
        "Saved answers are no longer available. Reload to check local saving.",
      );
    }
    return decoded.record;
  }, suppliedStorage);

// The revision comparison catches stale writers, but localStorage has no
// compare-and-swap transaction. Callers must also observe cross-tab events.
export const writeLocalDraft = (
  record: LocalDraftRecord,
  expectedRevision: string | null,
  suppliedStorage?: Storage,
): void =>
  withStorage((storage) => {
    if (!isRecord(record) || record.expiresAt <= Date.now()) {
      throw new LocalDraftStorageError(
        "The saved draft could not be prepared. You can continue filling in the form.",
      );
    }
    const serialized = JSON.stringify(record);
    if (new Blob([serialized]).size > MAX_DRAFT_RECORD_BYTES) {
      throw new LocalDraftStorageError(
        "These answers are too large to save locally. You can continue filling in the form.",
      );
    }
    const existing = readLocalDraft(record, storage);
    if ((existing?.revision ?? null) !== expectedRevision)
      throw new LocalDraftConflictError();
    if (existing === null && ownKeys(storage).length >= MAX_DRAFT_RECORDS) {
      // Expired/damaged records are the only records cleanup deletes silently.
      discoverLocalDrafts(record, storage);
      if (ownKeys(storage).length >= MAX_DRAFT_RECORDS) {
        throw new LocalDraftStorageError(
          "This browser already has ten saved forms. Delete a saved form before saving another.",
        );
      }
    }
    storage.setItem(localDraftKey(record), serialized);
  }, suppliedStorage);

export const removeLocalDraft = (
  identity: LocalDraftIdentity,
  expectedRevision?: string | null,
  suppliedStorage?: Storage,
): void =>
  withStorage((storage) => {
    if (expectedRevision !== undefined) {
      // Expiry forbids restoration, not deletion. Still compare the revision
      // so opting out cannot erase a newer record written by another tab.
      const existing = readLocalDraft(identity, storage, 0);
      if ((existing?.revision ?? null) !== expectedRevision)
        throw new LocalDraftConflictError();
    }
    storage.removeItem(localDraftKey(identity));
  }, suppliedStorage);
