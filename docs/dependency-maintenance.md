# Dependency maintenance

[Project overview](../README.md) · [Documentation](../README.md#documentation)

[Dependabot](../.github/dependabot.yml) checks the shared pnpm workspace every Monday
at 09:00 Europe/Moscow. Ordinary patch releases age three days and minor releases
seven days before becoming eligible. Related runtime, authentication, database,
UI and test packages form small groups; unrelated dependencies remain separate.
At most five ordinary npm update PRs stay open at once. TypeScript and
`@types/node` are excluded from those groups and get separate PRs, with shared
workspace pins updated together. Every PR runs the existing full CI workflow.

Security alerts and security update PRs must be enabled once in the repository's
**Settings → Advanced Security / Code security → Dependabot** settings, together
with the dependency graph. The YAML alone does not enable those repository
features. Security PRs do not wait for the weekly schedule or cooldown, including
fixes requiring a major version. Review actual exposure and prioritize applicable
critical fixes immediately. Keep security updates ungrouped. If pnpm's own release
age policy blocks an urgent reviewed fix, use a narrowly versioned temporary
`minimumReleaseAgeExclude` entry; do not disable the workspace policy globally.
These semantics follow the [GitHub Dependabot reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).

Dependabot cannot use two schedules for the same ecosystem/directory. The
[monthly review workflow](../.github/workflows/dependency-review.yml) therefore
checks stable npm major versions and pnpm, Node.js LTS and TypeScript on the first
day of each month at 10:00 Europe/Moscow. It opens one review issue with a
checklist and publishes the report in the workflow summary, without installing
dependencies or changing manifests. Repeated runs preserve the existing issue's
review notes and closed/deferred decisions. It can also run manually through
`workflow_dispatch`. The workflow needs Issues enabled and `issues: write` for
the repository's `GITHUB_TOKEN`; no additional secret is required.

Major migrations remain separate reviewed PRs after checking release notes,
breaking changes and compatibility, and may be deferred. GitHub Actions updates
are individual monthly PRs with a seven-day cooldown. Node Docker image updates
within the current major are monthly and separate from npm changes. pnpm and
Node.js changes need their own PRs coordinating all pins: `packageManager`, the
lockfile environment document, Docker install commands/images/digests, Netlify,
engine requirements, CI and deployment fixtures/documentation. The monthly issue
reminds maintainers about these pins; Dependabot does not synchronize all of them.
No workflow automatically approves or merges dependency changes.

The configuration takes effect after reaching the default branch. Confirm the
first hosted Dependabot run succeeds with the project's pnpm 12 lockfile; local
report checks cannot establish hosted updater compatibility. Do not downgrade
pnpm or rewrite the lockfile just to accommodate the bot.
