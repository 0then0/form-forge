// @vitest-environment node

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("production migrations require manual dispatch on main and isolate the database secret", () => {
  const workflow = readFileSync(
    new URL("../../../../.github/workflows/migrate.yml", import.meta.url),
    "utf8",
  );
  expect(workflow.split("on:\n")[1]?.split("\n\n")[0]?.trim()).toBe(
    "workflow_dispatch:",
  );
  expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("contents: read");
  const [setup, migration] = workflow.split(
    "      - name: Apply committed migrations\n",
  );
  expect(setup).toContain("pnpm install --frozen-lockfile --ignore-scripts");
  expect(setup).not.toContain("secrets.");
  expect(migration).toMatch(
    /DATABASE_URL: \$\{\{ secrets\.NEON_MIGRATION_DATABASE_URL \}\}/,
  );
  expect(migration).toContain("run: node apps/web/scripts/migrate.mjs");
});

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
