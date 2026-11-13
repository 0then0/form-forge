import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_TTL_MS,
  LOCAL_DRAFT_PREFIX,
  LocalDraftConflictError,
  LocalDraftStorageError,
  MAX_DRAFT_RECORD_BYTES,
  MAX_DRAFT_RECORDS,
  discoverLocalDrafts,
  localDraftKey,
  readLocalDraft,
  removeLocalDraft,
  writeLocalDraft,
  type LocalDraftRecord,
} from "./local-draft";

const record = (
  overrides: Partial<LocalDraftRecord> = {},
): LocalDraftRecord => {
  const now = Date.now();
  return {
    formatVersion: 1,
    origin: "https://forms.example.test",
    slug: "contact",
    versionId: "published-version",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + DRAFT_TTL_MS,
    revision: "revision-one",
    writerId: "writer-one",
    answers: { name: "unfinished", checkbox: false, number: "-" },
    ...overrides,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("local draft records", () => {
  it("deletes expired answers while still refusing a stale revision", () => {
    const draft = record();
    writeLocalDraft(draft, null);
    vi.spyOn(Date, "now").mockReturnValue(draft.expiresAt + 1);
    expect(() => removeLocalDraft(draft, "stale-revision")).toThrow(
      LocalDraftConflictError,
    );
    expect(window.localStorage.getItem(localDraftKey(draft))).not.toBeNull();
    removeLocalDraft(draft, draft.revision);
    expect(window.localStorage.getItem(localDraftKey(draft))).toBeNull();
  });
  it("stores answers and exact retry state in one atomic record", () => {
    const draft = record({
      attempt: {
        key: "attempt-key",
        versionId: "published-version",
        values: { name: "Ada", checkbox: false, number: 42 },
        context: {
          referrer: "https://example.test/",
          utm: { utm_source: "test" },
        },
      },
    });
    const writes = vi.spyOn(Storage.prototype, "setItem");
    writeLocalDraft(draft, null);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(readLocalDraft(draft)).toEqual(draft);
    expect(discoverLocalDrafts(draft)).toEqual({
      current: draft,
      incompatible: [],
      notices: [],
    });
  });

  it("isolates origin, form and immutable version and reports older versions", () => {
    const current = record();
    const previous = record({ versionId: "old-version" });
    const otherForm = record({ slug: "another-form" });
    const otherDeployment = record({ origin: "https://other.example.test" });
    for (const draft of [current, previous, otherForm, otherDeployment]) {
      writeLocalDraft(draft, null);
    }
    expect(
      new Set(
        [current, previous, otherForm, otherDeployment].map(localDraftKey),
      ).size,
    ).toBe(4);
    expect(discoverLocalDrafts(current)).toEqual({
      current,
      incompatible: [previous],
      notices: [],
    });
  });

  it("rejects stale writers and stale Discard without replacing a newer record", () => {
    const first = record();
    writeLocalDraft(first, null);
    const updated = {
      ...first,
      writerId: "writer-two",
      revision: "revision-two",
    };
    writeLocalDraft(updated, first.revision);
    expect(() =>
      writeLocalDraft({ ...first, revision: "stale" }, first.revision),
    ).toThrow(LocalDraftConflictError);
    expect(() => removeLocalDraft(first, first.revision)).toThrow(
      LocalDraftConflictError,
    );
    expect(readLocalDraft(first)).toEqual(updated);
    removeLocalDraft(updated, updated.revision);
    expect(readLocalDraft(first)).toBeNull();
  });

  it("cleans only app-owned expired, damaged and unsupported records with visible notices", () => {
    const current = record();
    const expired = record({
      slug: "expired",
      createdAt: Date.now() - DRAFT_TTL_MS - 100,
      updatedAt: Date.now() - DRAFT_TTL_MS - 100,
      expiresAt: Date.now() - 100,
    });
    window.localStorage.setItem(
      localDraftKey(expired),
      JSON.stringify(expired),
    );
    window.localStorage.setItem(
      `${LOCAL_DRAFT_PREFIX}damaged`,
      "{private answer",
    );
    window.localStorage.setItem(
      `${LOCAL_DRAFT_PREFIX}future`,
      JSON.stringify({ formatVersion: 2, answers: "private answer" }),
    );
    window.localStorage.setItem("another-app-draft", "keep me");
    window.localStorage.setItem("form-forge-visitor-id", "visitor");
    const found = discoverLocalDrafts(current);
    expect(found.current).toBeNull();
    expect(found.notices).toEqual(
      expect.arrayContaining([
        "An expired saved draft was removed after seven days.",
        "A damaged saved draft was removed.",
        "A saved draft used an unsupported format and was removed.",
      ]),
    );
    expect(JSON.stringify(found.notices)).not.toContain("private answer");
    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.getItem("another-app-draft")).toBe("keep me");
    expect(window.localStorage.getItem("form-forge-visitor-id")).toBe(
      "visitor",
    );
  });

  it.each([
    { values: { name: { nested: "invalid" } } },
    { key: "x".repeat(201) },
    { versionId: "wrong-version" },
    { context: { visitorId: "x".repeat(201) } },
  ])(
    "rejects the entire draft when its retry attempt is damaged: %j",
    (invalid) => {
      const draft = record();
      const raw = {
        ...draft,
        attempt: {
          key: "attempt",
          versionId: draft.versionId,
          values: { name: "Ada" },
          ...invalid,
        },
      };
      window.localStorage.setItem(localDraftKey(draft), JSON.stringify(raw));
      expect(discoverLocalDrafts(draft)).toMatchObject({
        current: null,
        notices: ["A damaged saved draft was removed."],
      });
    },
  );

  it("rejects invalid answer types, lengths, and mismatched record identities", () => {
    const draft = record();
    for (const invalid of [
      { ...draft, answers: { name: ["not supported"] } },
      { ...draft, answers: { name: "x".repeat(10_001) } },
      { ...draft, slug: "forged-identity" },
    ]) {
      window.localStorage.setItem(
        localDraftKey(draft),
        JSON.stringify(invalid),
      );
      expect(discoverLocalDrafts(draft).current).toBeNull();
      expect(window.localStorage.getItem(localDraftKey(draft))).toBeNull();
    }
  });

  it("bounds a record by UTF-8 size before replacing the current record", () => {
    const draft = record();
    writeLocalDraft(draft, null);
    const values = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [
        `field${index}`,
        "界".repeat(10_000),
      ]),
    );
    const oversized = record({
      revision: "large",
      answers: values,
      attempt: { key: "attempt", versionId: draft.versionId, values },
    });
    expect(new Blob([JSON.stringify(oversized)]).size).toBeGreaterThan(
      MAX_DRAFT_RECORD_BYTES,
    );
    expect(() => writeLocalDraft(oversized, draft.revision)).toThrow(
      "too large",
    );
    expect(readLocalDraft(draft)).toEqual(draft);
  });

  it("bounds the number of saved forms, retaining existing drafts", () => {
    for (let index = 0; index < MAX_DRAFT_RECORDS; index += 1) {
      writeLocalDraft(record({ slug: `form-${index}` }), null);
    }
    expect(() => writeLocalDraft(record(), null)).toThrow("ten saved forms");
    const existing = record({ slug: "form-0", revision: "updated" });
    writeLocalDraft(existing, "revision-one");
    expect(readLocalDraft(existing)?.revision).toBe("updated");
    expect(window.localStorage.length).toBe(MAX_DRAFT_RECORDS);
  });

  it("cleans expired own records before rejecting the record count limit", () => {
    for (let index = 0; index < MAX_DRAFT_RECORDS; index += 1) {
      window.localStorage.setItem(
        `${LOCAL_DRAFT_PREFIX}${index}`,
        "expired or damaged",
      );
    }
    const draft = record();
    writeLocalDraft(draft, null);
    expect(readLocalDraft(draft)).toEqual(draft);
    expect(window.localStorage.length).toBe(1);
  });

  it("reports denied storage access without exposing answers", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(() => discoverLocalDrafts(record())).toThrow(LocalDraftStorageError);
    expect(() => writeLocalDraft(record(), null)).toThrow(
      "Local saving is unavailable",
    );
  });

  it("preserves the last confirmed record after quota failure", () => {
    const first = record();
    writeLocalDraft(first, null);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    expect(() =>
      writeLocalDraft(record({ revision: "next" }), first.revision),
    ).toThrow(LocalDraftStorageError);
    expect(readLocalDraft(first)).toEqual(first);
  });
});
