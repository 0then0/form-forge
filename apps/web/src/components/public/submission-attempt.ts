import type { NormalizedSubmission } from "@form-forge/form-schema";

const storageKey = (slug: string, versionId: string) =>
  `form-forge-submission:${slug}:${versionId}`;

// Keep the existing session key. Only a digest, never answers, is stored here.
export const readSessionAttempt = (slug: string, versionId: string) => {
  try {
    const key = window.sessionStorage.getItem(storageKey(slug, versionId));
    const digest = window.sessionStorage.getItem(
      `${storageKey(slug, versionId)}:payload`,
    );
    const validDigest = digest !== null && /^[a-f0-9]{64}$/.test(digest);
    return {
      key: key || crypto.randomUUID(),
      digest: validDigest ? digest : null,
      unknown: Boolean(key) && !validDigest,
    };
  } catch {
    return { key: crypto.randomUUID(), digest: null, unknown: false };
  }
};

export const rememberSessionAttempt = (
  slug: string,
  versionId: string,
  key: string,
  digest: string,
) => {
  try {
    window.sessionStorage.setItem(storageKey(slug, versionId), key);
    window.sessionStorage.setItem(
      `${storageKey(slug, versionId)}:payload`,
      digest,
    );
  } catch {
    // Without opt-in, session recovery is best effort. The in-memory attempt
    // still binds the payload and key for retries in this page.
  }
};

export const clearSessionAttempt = (slug: string, versionId: string) => {
  try {
    window.sessionStorage.removeItem(storageKey(slug, versionId));
    window.sessionStorage.removeItem(`${storageKey(slug, versionId)}:payload`);
  } catch {
    // No answers are stored in sessionStorage.
  }
};

export const attemptDigest = async (
  versionId: string,
  values: NormalizedSubmission,
) => {
  const canonical = JSON.stringify({
    versionId,
    values: Object.fromEntries(
      Object.entries(values).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};
