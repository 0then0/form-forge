import { describe, expect, it, vi } from "vitest";

import { trustedForwardedFor } from "./request-fingerprint";

describe("trustedForwardedFor", () => {
  it("requires the proxy-only production header, not a framework-generated forwarding header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "");
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
  it("uses only the platform client IP on Netlify, ignoring spoofed ingress headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "netlify-site-id");
    try {
      const headers = new Headers({
        "x-form-forge-client-ip": "198.51.100.9",
        "x-forwarded-for": "198.51.100.10",
      });
      expect(trustedForwardedFor(headers, true)).toBeUndefined();
      headers.set("x-nf-client-connection-ip", "2001:db8::1");
      expect(trustedForwardedFor(headers, true)).toBe("2001:db8::1");
      expect(trustedForwardedFor(headers, false)).toBeUndefined();
      headers.set("x-nf-client-connection-ip", "not-an-ip");
      expect(trustedForwardedFor(headers, true)).toBeUndefined();
      headers.set("x-nf-client-connection-ip", " ");
      expect(trustedForwardedFor(headers, true)).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("does not trust Netlify headers on a self-hosted production server", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "");
    try {
      expect(
        trustedForwardedFor(
          new Headers({ "x-nf-client-connection-ip": "198.51.100.8" }),
          true,
        ),
      ).toBeUndefined();
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
