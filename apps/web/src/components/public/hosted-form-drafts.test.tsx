import { webcrypto } from "node:crypto";
import { StrictMode } from "react";
import type { FormSchemaV1 } from "@form-forge/form-schema";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostedForm } from "./hosted-form";
import { LOCAL_DRAFT_PREFIX, localDraftKey } from "./local-draft";

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: "Draft contact form",
  fields: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      key: "name",
      label: "Name",
      required: true,
      type: "shortText",
      width: "full",
    },
  ],
  settings: {
    submitLabel: "Send response",
    successTitle: "Response received",
    successMessage: "Thank you",
  },
};
const identity = {
  origin: window.location.origin,
  slug: "draft-contact",
  versionId: "published-version",
};
const key = localDraftKey(identity);
const mount = (extra: { compact?: boolean; closedMessage?: string } = {}) =>
  render(
    <HostedForm
      schema={schema}
      slug={identity.slug}
      versionId={identity.versionId}
      compact
      {...extra}
    />,
  );
const stored = () => JSON.parse(window.localStorage.getItem(key) ?? "null");
const success = () =>
  new Response(JSON.stringify({ data: { submissionId: "accepted" } }), {
    status: 201,
  });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HostedForm local drafts", () => {
  it("allows opting out after a saved response expires in an open tab", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Name *"), "Expired answer");
    const save = screen.getByRole("checkbox", {
      name: "Save answers on this device",
    });
    await user.click(save);
    const expiredAt = stored().expiresAt;
    vi.spyOn(Date, "now").mockReturnValue(expiredAt + 1);
    await user.click(save);
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(save).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name *")).toHaveValue("Expired answer");
  });
  it("keeps a damaged-record removal notice visible across StrictMode effect replay", () => {
    window.localStorage.setItem(key, "{damaged record");
    render(
      <StrictMode>
        <HostedForm
          compact
          schema={schema}
          slug={identity.slug}
          versionId={identity.versionId}
        />
      </StrictMode>,
    );
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(screen.getByText(/A damaged saved draft was removed/)).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    ).not.toBeChecked();
  });

  it("does not persist answers before consent and immediately saves current partial input on opt-in", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Name *"), "Unfinished answer");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    expect(stored().answers).toEqual({ name: "Unfinished answer" });
    expect(screen.getByText(/Saved on this device at/)).toBeVisible();
    expect(
      screen.getByText(/Only the saved confirmation means a write completed/),
    ).toBeVisible();
  });

  it("asks before applying saved answers after remount and Resume enables local saving", async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText("Name *"), "Ada");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    first.unmount();
    mount();
    expect(screen.getByText(/Saved answers from/)).toBeVisible();
    expect(screen.getByLabelText("Name *")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Send response" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^Resume$/ }));
    expect(screen.getByLabelText("Name *")).toHaveValue("Ada");
    expect(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Delete saved answers" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Delete saved answers" }),
    );
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("Discard removes a pending saved response without applying it", async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText("Name *"), "Saved name");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    first.unmount();
    mount();
    await user.click(screen.getByRole("button", { name: /^Discard$/ }));
    expect(screen.getByLabelText("Name *")).toHaveValue("");
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Send response" })).toBeEnabled();
  });

  it.each(["disable", "delete"] as const)(
    "cancels a pending debounced write after %s",
    async (action) => {
      const user = userEvent.setup();
      mount();
      await user.click(
        screen.getByRole("checkbox", { name: "Save answers on this device" }),
      );
      await user.type(screen.getByLabelText("Name *"), "Unsaved changes");
      expect(screen.getByText("Saving changes…")).toBeVisible();
      if (action === "disable")
        await user.click(
          screen.getByRole("checkbox", { name: "Save answers on this device" }),
        );
      else
        await user.click(
          screen.getByRole("button", { name: "Delete saved answers" }),
        );
      await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(screen.getByLabelText("Name *")).toHaveValue("Unsaved changes");
    },
  );

  it("clears answers and retry state after success, including a queued debounced save", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => success());
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    mount();
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    await user.type(screen.getByLabelText("Name *"), "Ada");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("heading", { name: "Response received" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(
      window.sessionStorage.getItem(
        "form-forge-submission:draft-contact:published-version",
      ),
    ).toBeNull();
    expect(
      window.sessionStorage.getItem(
        "form-forge-submission:draft-contact:published-version:payload",
      ),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows storage denial and allows ordinary filling and submission", async () => {
    const originalGetItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      storageKey: string,
    ) {
      if (this === window.localStorage)
        throw new DOMException("Denied", "SecurityError");
      return originalGetItem.call(this, storageKey);
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => success());
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    mount();
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    expect(
      screen.getByText(/Local storage is unavailable or full/),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    ).not.toBeChecked();
    await user.type(screen.getByLabelText("Name *"), "Ada");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("heading", { name: "Response received" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not send when quota prevents preserving a consented submission attempt", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => success());
    vi.stubGlobal("fetch", fetch);
    mount();
    await user.type(screen.getByLabelText("Name *"), "Ada");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      storageKey: string,
      value: string,
    ) {
      if (
        this === window.localStorage &&
        storageKey.startsWith(LOCAL_DRAFT_PREFIX)
      )
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      originalSetItem.call(this, storageKey, value);
    });
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(
      await screen.findByText(/The submission attempt could not be saved/),
    ).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(stored()).not.toHaveProperty("attempt");
    expect(screen.getByLabelText("Name *")).toHaveValue("Ada");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("heading", { name: "Response received" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses changed answers under an unresolved key and explicitly retries the original payload", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("Connection lost"))
      .mockImplementation(async () => success());
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText("Name *"), "Original");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByText("Connection lost");
    const prepared = stored().attempt;
    expect(prepared.values).toEqual({ name: "Original" });
    first.unmount();
    mount();
    await user.click(screen.getByRole("button", { name: /^Resume$/ }));
    await user.clear(screen.getByLabelText("Name *"));
    await user.type(screen.getByLabelText("Name *"), "Edited");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(
      await screen.findByText(
        /Retry the original attempt or explicitly start a new attempt/,
      ),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Retry original attempt" }),
    );
    await screen.findByRole("heading", { name: "Response received" });
    const original = fetch.mock.calls[0]?.[1];
    const retry = fetch.mock.calls[1]?.[1];
    expect(retry?.body).toBe(original?.body);
    expect(retry?.headers).toEqual(original?.headers);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("retains answers after definitive server validation and releases the rejected attempt", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid response",
              fieldErrors: { name: ["Please correct this answer"] },
            },
          }),
          { status: 422 },
        ),
      )
      .mockImplementation(async () => success());
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Name *"), "Rejected");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findAllByText("Please correct this answer");
    expect(screen.getByLabelText("Name *")).toHaveValue("Rejected");
    expect(stored().answers).toEqual({ name: "Rejected" });
    expect(stored()).not.toHaveProperty("attempt");
    expect(
      screen.queryByRole("button", { name: "Retry original attempt" }),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Name *"));
    await user.type(screen.getByLabelText("Name *"), "Corrected");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("heading", { name: "Response received" });
    expect(fetch.mock.calls[1]?.[1]?.headers).not.toEqual(
      fetch.mock.calls[0]?.[1]?.headers,
    );
  });

  it("requires explicit confirmation before changed answers get a new attempt after reload", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("Transport outcome unknown"))
      .mockImplementation(async () => success());
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText("Name *"), "Original");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByText("Transport outcome unknown");
    expect(window.localStorage.length).toBe(0);
    expect(Object.values(window.sessionStorage).join(" ")).not.toContain(
      "Original",
    );
    first.unmount();
    mount();
    await user.type(screen.getByLabelText("Name *"), "Different");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(
      await screen.findByText(
        /A new attempt uses a new key and could create a second response/,
      ),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Confirm new attempt" }),
    );
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("heading", { name: "Response received" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.headers).not.toEqual(
      fetch.mock.calls[0]?.[1]?.headers,
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).values).toEqual({
      name: "Different",
    });
  });

  it("requires a new attempt when a legacy session key has no payload binding", async () => {
    window.sessionStorage.setItem(
      "form-forge-submission:draft-contact:published-version",
      "legacy-key",
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () => success());
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Name *"), "Current answer");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(
      await screen.findByText(
        /A new attempt uses a new key and could create a second response/,
      ),
    ).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        "form-forge-submission:draft-contact:published-version",
      ),
    ).toBe("legacy-key");
    await user.click(
      screen.getByRole("button", { name: "Confirm new attempt" }),
    );
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByRole("heading", { name: "Response received" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toMatchObject({
      "Idempotency-Key": "legacy-key",
    });
  });

  it("asks for confirmation before discarding an attempt with an unknown outcome", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("Unknown transport outcome"));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText("Name *"), "Original answer");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await screen.findByText("Unknown transport outcome");
    const originalKey = stored().attempt.key;
    first.unmount();
    mount();
    await user.click(screen.getByRole("button", { name: /^Discard$/ }));
    expect(
      screen.getByText(
        /The previous attempt may already have been accepted. Discarding/,
      ),
    ).toBeVisible();
    expect(stored().attempt.key).toBe(originalKey);
    await user.click(screen.getByRole("button", { name: "Cancel discard" }));
    expect(stored().attempt.key).toBe(originalKey);
    await user.click(screen.getByRole("button", { name: /^Discard$/ }));
    await user.click(screen.getByRole("button", { name: "Confirm discard" }));
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(
      window.sessionStorage.getItem(
        "form-forge-submission:draft-contact:published-version",
      ),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Send response" })).toBeEnabled();
  });

  it("invalidates another tab's newer revision bound to a successful in-flight attempt", async () => {
    let finish: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Name *"), "Accepted answer");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    await user.click(screen.getByRole("button", { name: "Send response" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const previous = window.localStorage.getItem(key);
    const remote = {
      ...stored(),
      revision: "newer-remote-revision",
      writerId: "remote-tab",
      answers: { name: "Edited elsewhere while sending" },
    };
    expect(remote.attempt.values).toEqual({ name: "Accepted answer" });
    window.localStorage.setItem(key, JSON.stringify(remote));
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          oldValue: previous,
          newValue: JSON.stringify(remote),
          storageArea: window.localStorage,
        }),
      ),
    );
    expect(
      screen.getByText(/This saved response changed in another tab/),
    ).toBeVisible();
    await act(async () => {
      finish?.(success());
      await response;
    });
    await screen.findByRole("heading", { name: "Response received" });
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(
      window.sessionStorage.getItem(
        "form-forge-submission:draft-contact:published-version",
      ),
    ).toBeNull();
  });

  it("pauses writes on another tab's edit while keeping unsaved local answers", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Name *"), "Previously saved");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    await user.clear(screen.getByLabelText("Name *"));
    await user.type(screen.getByLabelText("Name *"), "Local edit");
    const previous = window.localStorage.getItem(key);
    const external = {
      ...stored(),
      revision: "external-revision",
      writerId: "external-writer",
      answers: { name: "Other tab" },
    };
    window.localStorage.setItem(key, JSON.stringify(external));
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          oldValue: previous,
          newValue: JSON.stringify(external),
          storageArea: window.localStorage,
        }),
      ),
    );
    expect(
      screen.getByText(/This saved response changed in another tab/),
    ).toBeVisible();
    expect(screen.getByLabelText("Name *")).toHaveValue("Local edit");
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(stored().answers).toEqual({ name: "Other tab" });
    await user.click(screen.getByRole("button", { name: "Keep my answers" }));
    expect(stored().answers).toEqual({ name: "Local edit" });
    expect(
      screen.queryByText(/This saved response changed in another tab/),
    ).not.toBeInTheDocument();
  });

  it.each([false, true])(
    "resolves Discard after another tab removed the record, with uncertain attempt %s",
    async (withAttempt) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(new TypeError("Unconfirmed response"));
      vi.stubGlobal("fetch", fetch);
      const user = userEvent.setup();
      mount();
      await user.type(screen.getByLabelText("Name *"), "Local answer");
      await user.click(
        screen.getByRole("checkbox", { name: "Save answers on this device" }),
      );
      if (withAttempt) {
        await user.click(screen.getByRole("button", { name: "Send response" }));
        await screen.findByText("Unconfirmed response");
      } else {
        await user.type(screen.getByLabelText("Name *"), " while saving");
        expect(screen.getByText("Saving changes…")).toBeVisible();
      }
      const previous = window.localStorage.getItem(key);
      window.localStorage.removeItem(key);
      act(() =>
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            oldValue: previous,
            newValue: null,
            storageArea: window.localStorage,
          }),
        ),
      );
      expect(
        screen.getByText(/This saved response changed in another tab/),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: /^Discard$/ }));
      if (withAttempt) {
        expect(
          screen.getByText(
            /The previous attempt may already have been accepted. Discarding/,
          ),
        ).toBeVisible();
        await user.click(
          screen.getByRole("button", { name: "Confirm discard" }),
        );
      }
      await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(
        screen.getByRole("checkbox", { name: "Save answers on this device" }),
      ).not.toBeChecked();
      expect(
        screen.getByRole("button", { name: "Send response" }),
      ).toBeEnabled();
      expect(
        screen.queryByText(/This saved response changed in another tab/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/The saved response could not be removed/),
      ).not.toBeInTheDocument();
      expect(fetch).toHaveBeenCalledTimes(withAttempt ? 1 : 0);
    },
  );

  it.each(["expired", "damaged", "unsupported"] as const)(
    "removes %s local records with a visible explanation and preserves other browser data",
    async (kind) => {
      const user = userEvent.setup();
      const first = mount();
      await user.type(screen.getByLabelText("Name *"), "Private answer");
      await user.click(
        screen.getByRole("checkbox", { name: "Save answers on this device" }),
      );
      first.unmount();
      const record = stored();
      window.localStorage.setItem("another-app", "preserved");
      if (kind === "expired") {
        record.createdAt = 1;
        record.updatedAt = 2;
        record.expiresAt = 3;
        window.localStorage.setItem(key, JSON.stringify(record));
      } else if (kind === "damaged")
        window.localStorage.setItem(key, "{not valid json");
      else
        window.localStorage.setItem(
          key,
          JSON.stringify({ ...record, formatVersion: 99 }),
        );
      mount();
      const message =
        kind === "expired"
          ? /An expired saved draft was removed/
          : kind === "damaged"
            ? /A damaged saved draft was removed/
            : /A saved draft used an unsupported format and was removed/;
      expect(screen.getByText(message)).toBeVisible();
      expect(screen.getByLabelText("Name *")).toHaveValue("");
      expect(screen.queryByText("Private answer")).not.toBeInTheDocument();
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.localStorage.getItem("another-app")).toBe("preserved");
    },
  );

  it("shows incompatible version saving without restoring answers automatically", async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText("Name *"), "Old version answer");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    first.unmount();
    render(
      <HostedForm
        compact
        schema={schema}
        slug={identity.slug}
        versionId="new-version"
      />,
    );
    expect(
      screen.getByText(/Saved answers exist for a different published version/),
    ).toBeVisible();
    expect(screen.getByLabelText("Name *")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: /^Resume$/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Delete incompatible saved answers" }),
    );
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("does not restore or submit a draft when the hosted form is closed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const first = mount();
    await user.type(screen.getByLabelText("Name *"), "Saved name");
    await user.click(
      screen.getByRole("checkbox", { name: "Save answers on this device" }),
    );
    first.unmount();
    mount({ closedMessage: "This form is paused" });
    expect(screen.getByText("This form is paused")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Resume$/ })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send response" }),
    ).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Discard$/ }));
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
