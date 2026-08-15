import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmClientNavigation,
  useUnsavedChangesWarning,
} from "./use-unsaved-changes-warning";

describe("useUnsavedChangesWarning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("keeps the editor open when browser history navigation is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const pushState = vi.spyOn(window.history, "pushState");
    renderHook(() => useUnsavedChangesWarning(true));

    await act(() => window.dispatchEvent(new PopStateEvent("popstate")));

    expect(confirm).toHaveBeenCalledWith("Discard unsaved form changes?");
    expect(pushState).toHaveBeenCalledTimes(2);
  });

  it("continues browser history navigation after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    renderHook(() => useUnsavedChangesWarning(true));

    await act(() => window.dispatchEvent(new PopStateEvent("popstate")));

    expect(back).toHaveBeenCalledOnce();
  });

  it("blocks programmatic client navigation when confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHook(() => useUnsavedChangesWarning(true));

    expect(confirmClientNavigation()).toBe(false);
  });

  it("removes the duplicate guard entry after changes are saved", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useUnsavedChangesWarning(dirty),
      { initialProps: { dirty: true } },
    );

    rerender({ dirty: false });

    expect(back).toHaveBeenCalledOnce();
  });
});
