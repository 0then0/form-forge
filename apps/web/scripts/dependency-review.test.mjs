// @vitest-environment node
import { expect, test } from "vitest";
import { renderReview } from "../../../.github/scripts/dependency-review.mjs";

const tools = {
  pnpmCurrent: "12.10.1",
  pnpmLatest: "12.14.0",
  nodeCurrent: "24.21.0",
  nodeLatest: "24.22.0",
  typescriptCurrent: "7.0.2",
  typescriptLatest: "7.0.2",
};
const date = new Date("2026-10-18T10:00:00Z");

test("monthly review separates major migrations from ordinary updates and tools", () => {
  const report = renderReview(
    {
      msw: { current: "2.15.0", latest: "3.0.3" },
      zod: { current: "4.6.5", latest: "4.6.7" },
      inngest: { current: "4.23.0", latest: "4.24.0" },
      typescript: { current: "7.0.2", latest: "8.0.0" },
      "@types/node": { current: "24.19.2", latest: "26.6.5" },
    },
    { ...tools, typescriptLatest: "8.0.0" },
    date,
  );
  const [dependencies, toolchain] = report.split("## Separate toolchain PRs");
  expect(dependencies).toContain("2026-10");
  expect(dependencies).toContain("- [ ] msw: 2.15.0 → 3.0.3");
  for (const name of ["zod", "inngest", "typescript", "@types/node"]) {
    expect(dependencies).not.toContain(name);
  }
  expect(toolchain).toContain("- [ ] TypeScript: 7.0.2 → 8.0.0");
  expect(toolchain).toContain("- [ ] @types/node: 24.19.2 → 26.6.5");
});

test("recursive production/dev workspace keys are normalized and deduplicated", () => {
  const report = renderReview(
    {
      "react@19.3.0": { current: "19.3.0", latest: "20.0.0" },
      "react@19.3.0 (dev)": { current: "19.3.0", latest: "20.0.0" },
      "@scope/package@1.0.0 (optional)": { current: "1.0.0", latest: "2.0.0" },
    },
    tools,
    date,
  );
  expect(report.match(/- \[ \] react:/g)).toHaveLength(1);
  expect(report).toContain("- [ ] @scope/package: 1.0.0 → 2.0.0");
});

test("empty discovery is reported without suggesting an unchanged TypeScript update", () => {
  const report = renderReview({}, tools, date);
  expect(report).toContain("No new stable major versions");
  expect(report).toContain("- TypeScript: 7.0.2 (current)");
  expect(report).not.toContain("- [ ] TypeScript");
});

test("failed or malformed discovery cannot become a reassuring empty report", () => {
  for (const input of [
    null,
    [],
    { error: { code: "REGISTRY_FAILURE" } },
    { bad: { current: "1.0.0" } },
  ]) {
    expect(() => renderReview(input, tools, date)).toThrow();
  }
  expect(() =>
    renderReview({}, { ...tools, pnpmLatest: undefined }, date),
  ).toThrow();
});
