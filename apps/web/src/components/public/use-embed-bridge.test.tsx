import { act, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useEmbedBridge } from "./use-embed-bridge";

const originalParent = Object.getOwnPropertyDescriptor(window, "parent");
const originalUrl = window.location.href;
afterEach(() => {
  if (originalParent) Object.defineProperty(window, "parent", originalParent);
  window.history.replaceState(null, "", originalUrl);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const Harness = ({ submitted = false }: { submitted?: boolean }) => {
  const ref = useEmbedBridge(true, submitted);
  return <div ref={ref}>Embedded content</div>;
};
const setup = (origin = "https://parent.example") => {
  const postMessage = vi.fn();
  Object.defineProperty(window, "parent", {
    value: { postMessage },
    configurable: true,
  });
  window.history.replaceState(
    null,
    "",
    `/?ff_parent_origin=${encodeURIComponent(origin)}&ff_embed_id=11111111-1111-4111-8111-111111111111`,
  );
  vi.spyOn(document, "referrer", "get").mockReturnValue(
    "https://parent.example/page",
  );
  return postMessage;
};

test("reports content height after errors, conditional changes and submission; cleans up the observer", () => {
  const postMessage = setup();
  let height = 200;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ height }) as DOMRect,
  );
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => {
    throw new Error("Animation frames are suspended offscreen");
  });
  const view = render(<Harness />);
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "ready" }),
    "https://parent.example",
  );
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "resize", height: 200 }),
    "https://parent.example",
  );
  height = 340;
  act(() => resize());
  height = 520;
  act(() => resize());
  height = 150;
  view.rerender(<Harness submitted />);
  act(() => resize());
  const payloads = postMessage.mock.calls.map(([message]) => message);
  expect(
    payloads
      .filter((message) => message.type === "resize")
      .map((message) => message.height),
  ).toEqual([200, 340, 520, 150]);
  expect(payloads.some((message) => message.type === "submitted")).toBe(true);
  expect(payloads.every((message) => !Object.hasOwn(message, "values"))).toBe(
    true,
  );
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

test("does not disclose ready or submitted events to an origin different from the actual parent referrer", () => {
  const postMessage = setup("https://attacker.example");
  render(<Harness submitted />);
  expect(postMessage).not.toHaveBeenCalled();
});

test("validates parent, origin, channel and dispose format before disconnecting the bridge", () => {
  setup();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: 200,
  } as DOMRect);
  const view = render(<Harness />);
  const data = {
    protocol: "form-forge/embed",
    version: 1,
    channel: "11111111-1111-4111-8111-111111111111",
    type: "dispose",
  };
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://attacker.example",
      source: window.parent,
      data,
    }),
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://parent.example",
      source: window,
      data,
    }),
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://parent.example",
      source: window.parent,
      data: { ...data, channel: "wrong" },
    }),
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://parent.example",
      source: window.parent,
      data: { ...data, unexpected: true },
    }),
  );
  expect(disconnect).not.toHaveBeenCalled();
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://parent.example",
      source: window.parent,
      data,
    }),
  );
  expect(disconnect).toHaveBeenCalledOnce();
  view.unmount();
});
