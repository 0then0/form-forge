import { describe, expect, it } from "vitest";

import {
  apiError,
  MAX_FORM_SCHEMA_BODY_BYTES,
  MAX_SUBMISSION_BODY_BYTES,
  parseJsonBody,
} from "./api";
import { AppError } from "./errors";

describe("parseJsonBody", () => {
  it("accepts valid domain payloads larger than the old shared limit", async () => {
    const submission = JSON.stringify({ value: "x".repeat(70_000) });
    await expect(
      parseJsonBody(
        new Request("http://localhost", {
          body: submission,
          method: "POST",
        }),
        MAX_SUBMISSION_BODY_BYTES,
      ),
    ).resolves.toEqual({ value: "x".repeat(70_000) });
  });

  it("keeps separate bounded limits for schemas and submissions", () => {
    expect(MAX_FORM_SCHEMA_BODY_BYTES).toBe(16_000_000);
    expect(MAX_SUBMISSION_BODY_BYTES).toBe(8_000_000);
    expect(MAX_FORM_SCHEMA_BODY_BYTES).toBeGreaterThan(
      MAX_SUBMISSION_BODY_BYTES,
    );
  });

  it("stops reading a chunked body when the limit is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(100)));
      },
    });
    const request = new Request("http://localhost", {
      body,
      method: "POST",
      ...({ duplex: "half" } as RequestInit),
    });

    await expect(parseJsonBody(request, 32)).rejects.toMatchObject({
      status: 413,
    });
    expect(cancelled).toBe(true);
  });
});

describe("apiError", () => {
  it("tells clients when a rate-limited request can be retried", () => {
    const response = apiError(
      new AppError("RATE_LIMITED", "Try again later", 429),
    );

    expect(response.headers.get("Retry-After")).toBe("600");
  });
});
