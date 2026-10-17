// @vitest-environment node

import { describe, expect, it } from "vitest";
import { proxy } from "../../proxy";

describe("admin request origin protection", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects cross-origin %s including same-site subdomains",
    (method) => {
      for (const origin of [
        "https://attacker.example",
        "http://sub.localhost:3000",
        "null",
      ]) {
        const response = proxy(
          new Request(
            "http://localhost:3000/api/admin/workspaces/workspace/forms/form-id/restore",
            { method, headers: { origin, "sec-fetch-site": "same-site" } },
          ),
        );
        expect(response.status).toBe(403);
      }
    },
  );

  it("accepts the configured origin even behind an internal proxy hostname", () => {
    const response = proxy(
      new Request("http://web:3000/api/admin/workspaces/workspace/forms", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        },
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects cross-site Fetch Metadata when Origin is missing", () => {
    expect(
      proxy(
        new Request(
          "http://localhost:3000/api/admin/workspaces/workspace/forms",
          { method: "POST", headers: { "sec-fetch-site": "cross-site" } },
        ),
      ).status,
    ).toBe(403);
  });

  it("preserves non-browser clients and read-only requests", () => {
    for (const request of [
      new Request(
        "http://localhost:3000/api/admin/workspaces/workspace/forms",
        { method: "POST" },
      ),
      new Request(
        "http://localhost:3000/api/admin/workspaces/workspace/forms",
        { headers: { origin: "https://other.example" } },
      ),
    ])
      expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });
});
