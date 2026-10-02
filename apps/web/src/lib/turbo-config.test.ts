// @vitest-environment node

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { z } from "zod";

import { env } from "@/env";

test("forwards the application env contract and invalidates builds for env files", () => {
  const config = z
    .object({
      globalEnv: z.array(z.string()),
      tasks: z.object({
        "@form-forge/web#build": z.object({ inputs: z.array(z.string()) }),
        test: z.object({ env: z.array(z.string()), cache: z.boolean() }),
      }),
    })
    .parse(
      JSON.parse(
        readFileSync(
          new URL("../../../../turbo.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  for (const key of Object.keys(env)) {
    if (key === "TEST_DATABASE_URL") {
      expect(config.tasks.test.env).toContain(key);
    } else {
      expect(config.globalEnv).toContain(key);
    }
  }
  expect(config.tasks["@form-forge/web#build"].inputs).toEqual(
    expect.arrayContaining([
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
    ]),
  );
  expect(config.tasks.test.cache).toBe(false);
});
