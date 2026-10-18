"use client";

import { useEffect, useRef } from "react";

export const useEmbedBridge = (compact: boolean, submitted: boolean) => {
  const root = useRef<HTMLDivElement>(null);
  const notifySubmitted = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!compact || !root.current || window.parent === window) return;
    const params = new URLSearchParams(window.location.search);
    const origin = params.get("ff_parent_origin");
    const channel = params.get("ff_embed_id");
    if (!origin || !channel || !/^[a-f0-9-]{36}$/i.test(channel)) return;
    try {
      const parsed = new URL(origin);
      if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== origin)
        return;
      if (document.referrer && new URL(document.referrer).origin !== origin)
        return;
    } catch {
      return;
    }
    const post = (type: "ready" | "resize" | "submitted", height?: number) => {
      window.parent.postMessage(
        {
          protocol: "form-forge/embed",
          version: 1,
          channel,
          type,
          ...(height === undefined ? {} : { height }),
        },
        origin,
      );
    };
    const element = root.current;
    let previousHeight = 0;
    // Measure immediately, including below-viewport frames where browsers can
    // suspend requestAnimationFrame. ResizeObserver already batches layout.
    const measure = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height > 0 && height !== previousHeight) {
        previousHeight = height;
        post("resize", height);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const dispose = () => {
      notifySubmitted.current = null;
      observer.disconnect();
      window.removeEventListener("message", receive);
    };
    const receive = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (
        event.origin !== origin ||
        event.source !== window.parent ||
        !message ||
        typeof message !== "object" ||
        Array.isArray(message)
      )
        return;
      if (
        !("protocol" in message) ||
        message.protocol !== "form-forge/embed" ||
        !("version" in message) ||
        message.version !== 1 ||
        !("channel" in message) ||
        message.channel !== channel ||
        !("type" in message) ||
        message.type !== "dispose" ||
        Object.keys(message).length !== 4
      )
        return;
      dispose();
    };
    window.addEventListener("message", receive);
    notifySubmitted.current = () => post("submitted");
    post("ready");
    measure();
    return dispose;
  }, [compact]);
  useEffect(() => {
    if (submitted) notifySubmitted.current?.();
  }, [submitted]);
  return root;
};
