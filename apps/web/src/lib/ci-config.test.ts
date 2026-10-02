// @vitest-environment node

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("retains browser diagnostics after a successful retry, not only failed jobs", () => {
  const workflow = readFileSync(
    new URL("../../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const diagnostics = workflow
    .split("      - name: Upload browser diagnostics\n")[1]
    ?.split("\n      - ")[0];

  expect(diagnostics).toBeDefined();
  // GitHub evaluates this status condition even when an earlier step failed,
  // and it remains true when Playwright recovers a failed attempt with retry.
  expect(diagnostics).toMatch(/^\s+if: \$\{\{ !cancelled\(\) \}\}$/m);
  expect(diagnostics).toContain("apps/web/playwright-report/");
  expect(diagnostics).toContain("apps/web/test-results/");
  expect(diagnostics).toContain("if-no-files-found: ignore");
});
