import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, test, vi } from "vitest";

const source = readFileSync("public/embed.js", "utf8");
const embedWindow = window as typeof window & {
  FormForgeEmbed?: {
    scan: (root?: Document) => void;
    mount: (frame: HTMLIFrameElement) => void;
    destroy: (frame: HTMLIFrameElement) => void;
    destroyAll: () => void;
  };
};
const start = () =>
  runInNewContext(source, {
    window: embedWindow,
    document,
    location,
    HTMLIFrameElement,
    MutationObserver,
    crypto,
    CustomEvent,
    URL,
    getComputedStyle,
  });
const frame = (slug: string) => {
  const element = document.createElement("iframe");
  element.src = `https://forms.example/f/${slug}?embed=1`;
  element.setAttribute("data-form-forge", "");
  document.body.append(element);
  return element;
};
const send = (
  element: HTMLIFrameElement,
  overrides: Record<string, unknown> = {},
  origin = "https://forms.example",
  source: MessageEventSource | null = element.contentWindow,
) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      source,
      data: {
        protocol: "form-forge/embed",
        version: 1,
        channel: new URL(element.src).searchParams.get("ff_embed_id"),
        type: "resize",
        height: 321,
        ...overrides,
      },
    }),
  );
};
afterEach(() => {
  embedWindow.FormForgeEmbed?.destroyAll();
  delete embedWindow.FormForgeEmbed;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test("isolates multiple iframe channels and rejects forged origins, sources and payloads", () => {
  const first = frame("one");
  const second = frame("two");
  start();
  expect(new URL(first.src).searchParams.get("ff_parent_origin")).toBe(
    location.origin,
  );
  send(first, {}, "https://attacker.example");
  send(first, {}, "https://forms.example", second.contentWindow);
  send(first, { channel: new URL(second.src).searchParams.get("ff_embed_id") });
  for (const height of [-1, 0, 0.5, "100", 100001, Number.NaN])
    send(first, { height });
  send(first, { values: { private: "secret" } });
  expect(first.style.height).toBe("");
  send(first);
  expect(first.style.height).toBe("321px");
  expect(second.style.height).toBe("");
  send(second, { height: 654 });
  expect(second.style.height).toBe("654px");
});

test("emits events without values and removes handlers on explicit or DOM disposal", async () => {
  const element = frame("one");
  start();
  const ready = vi.fn();
  const submitted = vi.fn();
  element.addEventListener("formforge:ready", ready);
  element.addEventListener("formforge:submitted", submitted);
  send(element, { type: "ready", height: undefined }); // Unexpected height property must be rejected.
  expect(ready).not.toHaveBeenCalled();
  const notify = (type: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://forms.example",
        source: element.contentWindow,
        data: {
          protocol: "form-forge/embed",
          version: 1,
          channel: new URL(element.src).searchParams.get("ff_embed_id"),
          type,
        },
      }),
    );
  notify("ready");
  notify("submitted");
  expect(ready).toHaveBeenCalledOnce();
  expect(submitted).toHaveBeenCalledOnce();
  expect(
    (submitted.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail,
  ).toEqual({
    iframe: element,
  });
  start();
  notify("ready");
  expect(ready).toHaveBeenCalledTimes(2); // Duplicate script execution does not duplicate listeners.
  embedWindow.FormForgeEmbed?.destroy(element);
  send(element);
  expect(element.style.height).toBe("");
  embedWindow.FormForgeEmbed?.mount(element);
  send(element);
  expect(element.style.height).toBe("321px");
  const remove = vi.spyOn(window, "removeEventListener");
  element.remove();
  await Promise.resolve();
  expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
});

test("accounts for iframe borders and padding when the parent uses border-box sizing", () => {
  const element = frame("bordered");
  element.style.boxSizing = "border-box";
  element.style.border = "2px solid black";
  element.style.padding = "3px";
  start();
  send(element);
  expect(element.style.height).toBe("331px");
});
