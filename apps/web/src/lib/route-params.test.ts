import { describe, expect, it } from "vitest";

import { AppError } from "./errors";
import { requireUuidParam } from "./route-params";

describe("requireUuidParam", () => {
  it("returns a valid UUID unchanged", () => {
    expect(
      requireUuidParam("11111111-1111-4111-8111-111111111111", "form ID"),
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("turns malformed route input into a client error", () => {
    expect(() => requireUuidParam("not-a-uuid", "form ID")).toThrow(AppError);
    try {
      requireUuidParam("not-a-uuid", "form ID");
    } catch (error) {
      expect(error).toMatchObject({ code: "BAD_REQUEST", status: 400 });
    }
  });
});
