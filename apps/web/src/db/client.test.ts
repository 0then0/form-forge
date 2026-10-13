// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";

// The startup guard must reject unsafe deployments before opening a pool.
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("Vercel functions reject development credentials without next start", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("INNGEST_DEV", "1");

  await expect(import("./client")).rejects.toThrow(
    "Invalid production configuration",
  );
});
