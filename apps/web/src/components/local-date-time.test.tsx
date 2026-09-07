import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalDateTime } from "./local-date-time";

describe("LocalDateTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the browser's local formatter after hydration", async () => {
    const format = vi.fn(() => "Aug 15, 2026, 9:30 PM");
    const formatter = vi.fn(function DateTimeFormat() {
      return { format };
    });
    vi.stubGlobal("Intl", { DateTimeFormat: formatter });

    render(<LocalDateTime value="2026-08-15T18:30:00.000Z" />);

    expect(await screen.findByText("Aug 15, 2026, 9:30 PM")).toBeVisible();
    expect(formatter).toHaveBeenCalledWith(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  });

  it("renders a stable fallback for an invalid timestamp", () => {
    render(<LocalDateTime value="not-a-date" />);

    expect(screen.getByText("Date unavailable")).toBeVisible();
  });
});
