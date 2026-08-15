import { describe, expect, it } from "vitest";

import { deriveDeliveryStatus } from "./delivery-status";

describe("deriveDeliveryStatus", () => {
  it("succeeds when there are no endpoints", () => {
    expect(deriveDeliveryStatus([])).toBe("succeeded");
  });

  it("stays processing while any delivery can progress", () => {
    expect(deriveDeliveryStatus(["succeeded", "pending", "failed"])).toBe(
      "processing",
    );
  });

  it("fails after all remaining deliveries are terminal", () => {
    expect(deriveDeliveryStatus(["succeeded", "failed"])).toBe("failed");
  });
});
