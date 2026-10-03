import { describe, expect, it, vi } from "vitest";

import { trustedForwardedFor } from "./request-fingerprint";

describe("trustedForwardedFor", () => {
  it("requires the proxy-only production header, not a framework-generated forwarding header", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const headers = new Headers({ "x-forwarded-for": "198.51.100.8" });
      expect(trustedForwardedFor(headers, true)).toBeUndefined();
      headers.set("x-form-forge-client-ip", "198.51.100.9");
      expect(trustedForwardedFor(headers, true)).toBe("198.51.100.9");
      expect(trustedForwardedFor(headers, false)).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
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
  it("requires an IP address rather than an arbitrary rotating header value", () => {
    expect(
      trustedForwardedFor(
        new Headers({ "x-forwarded-for": "not-an-address" }),
        true,
      ),
    ).toBeUndefined();
    expect(
      trustedForwardedFor(
        new Headers({ "x-forwarded-for": "2001:db8::1" }),
        true,
      ),
    ).toBe("2001:db8::1");
  });
});
