"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const WARNING = "Discard unsaved form changes?";
const GUARD_KEY = "__formForgeUnsavedGuard";
const CLIENT_NAVIGATION_EVENT = "form-forge:before-client-navigation";

export const confirmClientNavigation = (): boolean =>
  window.dispatchEvent(
    new Event(CLIENT_NAVIGATION_EVENT, { cancelable: true }),
  );

export const useUnsavedChangesWarning = (dirty: boolean) => {
  const wasDirty = useRef(false);

  useLayoutEffect(() => {
    if (
      wasDirty.current &&
      !dirty &&
      window.history.state?.[GUARD_KEY] === true
    ) {
      window.history.back();
    }
    wasDirty.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const currentUrl = window.location.href;
    const guardedState = { ...window.history.state, [GUARD_KEY]: true };
    window.history.pushState(guardedState, "", currentUrl);

    const clearGuard = () => {
      if (window.history.state?.[GUARD_KEY] !== true) return;
      const { [GUARD_KEY]: _guard, ...state } = window.history.state as Record<
        string,
        unknown
      >;
      window.history.replaceState(state, "", window.location.href);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const beforeNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        destination.href === window.location.href
      ) {
        return;
      }
      if (!window.confirm(WARNING)) {
        event.preventDefault();
      } else {
        clearGuard();
      }
    };
    const beforeHistoryNavigation = () => {
      if (window.confirm(WARNING)) {
        window.removeEventListener("popstate", beforeHistoryNavigation);
        window.history.back();
        return;
      }
      window.history.pushState(guardedState, "", currentUrl);
    };
    const beforeClientNavigation = (event: Event) => {
      if (!window.confirm(WARNING)) {
        event.preventDefault();
      } else {
        clearGuard();
      }
    };

    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", beforeHistoryNavigation);
    window.addEventListener(CLIENT_NAVIGATION_EVENT, beforeClientNavigation);
    document.addEventListener("click", beforeNavigation, true);
    return () => {
      clearGuard();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", beforeHistoryNavigation);
      window.removeEventListener(
        CLIENT_NAVIGATION_EVENT,
        beforeClientNavigation,
      );
      document.removeEventListener("click", beforeNavigation, true);
    };
  }, [dirty]);
};
