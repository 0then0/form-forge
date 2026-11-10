# Dependency maintenance

[Project overview](../README.md) · [Documentation](../README.md#documentation)

This page describes how the project keeps dependencies current. It is mainly for
maintainers and contributors reviewing dependency pull requests.

## Automated updates

[Dependabot](../.github/dependabot.yml) checks the pnpm workspace every Monday at
09:00 Europe/Moscow and opens pull requests for patch and minor releases:

- Patch releases wait three days and minor releases seven days after publication
  before they are proposed.
- Related packages are grouped: React and Next.js, authentication, database,
  Tailwind, Radix UI, TanStack, unit testing and component testing. Other
  packages, including TypeScript and `@types/node`, get individual pull requests.
- At most five npm update pull requests are open at a time.
- GitHub Actions are updated monthly, one pull request per action.
- The Node.js Docker image is updated monthly within its current major version,
  separately from npm changes.

Every pull request runs the full CI workflow. No workflow approves or merges
dependency changes automatically.

## Security updates

Dependabot security alerts and security update pull requests are enabled for the
repository. Security updates do not wait for the weekly schedule or cooldown and
can include major versions. They are not grouped with other updates.

For each alert, check whether the vulnerable code is reachable in this project,
and fix applicable critical issues first. When a transitive dependency has no
fixed upstream release, use a narrowly scoped entry in `overrides` in
[`pnpm-workspace.yaml`](../pnpm-workspace.yaml), with a comment explaining when
to remove it. If pnpm's minimum release age blocks an urgent reviewed fix, add a
version-specific `minimumReleaseAgeExclude` entry instead of disabling the policy.

## Monthly review

Major versions and the toolchain are reviewed by hand. On the first day of each
month at 10:00 Europe/Moscow, the
[dependency review workflow](../.github/workflows/dependency-review.yml) opens an
issue that lists stable major updates for npm packages, and new versions of pnpm,
Node.js LTS and TypeScript. It does not install anything or change manifests, and
it can also be run manually.

For each item, read the release notes and breaking changes, then either open a
separate pull request or record why it is deferred. A listed version is not a
requirement to upgrade.

## Toolchain changes

pnpm and Node.js versions are pinned in several places that must change together
in one pull request:

- **pnpm:** `packageManager` in `package.json`, the `packageManagerDependencies`
  section of `pnpm-lock.yaml`, the install command in the `Dockerfile`, and the
  versions mentioned in the documentation.
- **Node.js:** Docker images and digests in the `Dockerfile` and Compose files,
  `NODE_VERSION` in `netlify.toml`, `engines` in `package.json`, the CI matrix,
  deployment test fixtures and documentation.

Dependabot does not update all of these pins. Do not downgrade pnpm or rewrite the
lockfile to suit the bot.
