import { describe, expect, it } from "vitest";

import {
  MAX_FORM_SCHEMA_BODY_BYTES,
  MAX_SUBMISSION_BODY_BYTES,
  parseJsonBody,
} from "./api";

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
    expect(MAX_FORM_SCHEMA_BODY_BYTES).toBeGreaterThan(65_536);
    expect(MAX_SUBMISSION_BODY_BYTES).toBeGreaterThan(
      MAX_FORM_SCHEMA_BODY_BYTES,
    );
  });
});
