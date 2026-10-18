import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const stableVersion = /^(\d+)\.\d+\.\d+$/;
const toolchain = new Set(["typescript", "@types/node", "pnpm"]);

export function renderReview(outdated, tools, date) {
  if (!outdated || typeof outdated !== "object" || Array.isArray(outdated)) {
    throw new Error("Expected pnpm outdated --format json object");
  }
  const major = new Set();
  for (const [key, entry] of Object.entries(outdated)) {
    // Recursive pnpm output disambiguates shared production/dev dependencies
    // with keys such as react@19.3.0 and react@19.3.0 (dev).
    const name =
      /^((?:@[a-z\d._-]+\/)?[a-z\d._-]+)(?:@\d+\.\d+\.\d+)?(?: \((?:dev|optional|peer)\))?$/i.exec(
        key,
      )?.[1];
    if (
      !name ||
      !entry ||
      typeof entry.current !== "string" ||
      typeof entry.latest !== "string"
    ) {
      throw new Error("Unexpected pnpm outdated entry");
    }
    const current = stableVersion.exec(entry.current);
    const latest = stableVersion.exec(entry.latest);
    if (!current || !latest)
      throw new Error(`Expected stable versions for ${name}`);
    if (!toolchain.has(name) && Number(latest[1]) > Number(current[1])) {
      major.add(`- [ ] ${name}: ${entry.current} → ${entry.latest}`);
    }
  }
  for (const value of Object.values(tools)) {
    if (typeof value !== "string" || !stableVersion.test(value))
      throw new Error("Unexpected toolchain version");
  }
  const toolLine = (name, current, latest) =>
    current === latest
      ? `- ${name}: ${current} (current)`
      : `- [ ] ${name}: ${current} → ${latest}`;
  return `# Monthly dependency review: ${date.toISOString().slice(0, 7)}

Automated discovery only. No dependency files were changed or installed by this report.
Security fixes use Dependabot alerts/PRs immediately; do not wait for this review.

## Major application dependencies

${[...major].sort().join("\n") || "No new stable major versions reported by pnpm."}

## Separate toolchain PRs

${toolLine("pnpm", tools.pnpmCurrent, tools.pnpmLatest)}
${toolLine("Node.js (Docker; latest LTS)", tools.nodeCurrent, tools.nodeLatest)}
${toolLine("TypeScript", tools.typescriptCurrent, tools.typescriptLatest)}
${outdated["@types/node"] ? `- [ ] @types/node: ${outdated["@types/node"].current} → ${outdated["@types/node"].latest}\n` : ""}
Create one PR per tool when an update is appropriate; a listed version is not a requirement to upgrade.
Coordinate pnpm's packageManager pin, Docker RUN pin, lockfile environment document and docs.
Coordinate Node's Docker images/digests, Netlify pin, supported engines, CI matrix and deployment fixtures/docs.
Keep TypeScript consistent in all workspace manifests and check Next.js/compiler compatibility.

## Review before merging

- Read upstream release notes, breaking changes, Node/peer requirements and migration instructions.
- Let ordinary new releases age 3–7 days; urgent applicable security fixes are exempt.
- Keep each major migration separate; defer or close candidates that do not benefit this project.
- Run format:check, typecheck, lint, knip, test, test:deployment, test:e2e, build and test:production.
- Review advisories for actual exposure; passing CI alone does not establish security applicability.
`;
}

const getJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok)
    throw new Error(`Version lookup failed: HTTP ${response.status}`);
  return response.json();
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const input = process.argv[2];
  if (!input) throw new Error("Pass the pnpm outdated JSON file");
  const [source, manifest, dockerfile, pnpmRelease, nodeReleases] =
    await Promise.all([
      readFile(input, "utf8"),
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("Dockerfile", "utf8"),
      getJson("https://registry.npmjs.org/pnpm/latest"),
      getJson("https://nodejs.org/dist/index.json"),
    ]);
  const outdated = JSON.parse(source);
  if (!Array.isArray(nodeReleases))
    throw new Error("Invalid Node release index");
  const nodeLatest = nodeReleases.find(
    (release) =>
      release.lts && stableVersion.test(release.version?.replace(/^v/, "")),
  );
  const report = renderReview(
    outdated,
    {
      pnpmCurrent: manifest.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+)/)?.[1],
      pnpmLatest: pnpmRelease.version,
      nodeCurrent: dockerfile.match(/^FROM node:(\d+\.\d+\.\d+)/m)?.[1],
      nodeLatest: nodeLatest?.version.replace(/^v/, ""),
      typescriptCurrent: manifest.devDependencies?.typescript,
      typescriptLatest:
        outdated.typescript?.latest ?? manifest.devDependencies?.typescript,
    },
    new Date(),
  );
  process.stdout.write(report);
}
