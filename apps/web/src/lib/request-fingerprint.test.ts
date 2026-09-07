import { describe, expect, it } from "vitest";

import { trustedForwardedFor } from "./request-fingerprint";

describe("trustedForwardedFor", () => {
  it("ignores client-provided forwarding headers unless a trusted proxy is enabled", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.8, 10.0.0.1",
    });

    expect(trustedForwardedFor(headers, false)).toBeUndefined();
    expect(trustedForwardedFor(headers, true)).toBe("198.51.100.8");
  });

  it("does not turn an empty forwarding header into a fingerprint", () => {
    expect(
      trustedForwardedFor(new Headers({ "x-forwarded-for": " " }), true),
    ).toBeUndefined();
  });
});
