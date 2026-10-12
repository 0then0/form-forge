// @vitest-environment node
import { readFileSync } from "node:fs";
import { Inngest } from "inngest";
import { expect, test, vi } from "vitest";

test("generic production template preserves managed Inngest defaults", () => {
  const example = readFileSync(
    new URL("../.env.production.example", import.meta.url),
    "utf8",
  );
  const settings = Object.fromEntries(
    example
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  expect(settings.INNGEST_BASE_URL).toBeUndefined();
  expect(settings.INNGEST_SERVE_ORIGIN).toBeUndefined();
  vi.stubEnv("INNGEST_BASE_URL", undefined);
  vi.stubEnv("INNGEST_EVENT_API_BASE_URL", undefined);
  vi.stubEnv("INNGEST_DEV", "0");
  try {
    expect(new Inngest({ id: "config-test" }).eventBaseUrl).toBe(
      "https://inn.gs/",
    );
    vi.stubEnv("INNGEST_BASE_URL", "http://inngest:8288");
    expect(new Inngest({ id: "config-test" }).eventBaseUrl).toBe(
      "http://inngest:8288",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
