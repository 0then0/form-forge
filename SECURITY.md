# Security policy

## Supported versions

Security fixes target the latest stable release. Older releases and prereleases
do not have a separate maintenance commitment; upgrade to the latest stable
version when a fix is available. See [releases](https://github.com/0then0/form-forge/releases)
and [CHANGELOG.md](CHANGELOG.md). There is no guaranteed response or fix timeline.

## Report a vulnerability privately

Do not disclose exploitable vulnerabilities, credentials or submission data in
public issues, PRs or discussions.

Use **Security → Advisories → Report a vulnerability** on
[GitHub](https://github.com/0then0/form-forge/security/advisories/new) when private
vulnerability reporting is enabled. If that option is unavailable, contact
[the maintainer](https://github.com/0then0) through an available private contact
method. If no private contact is listed, open a minimal issue requesting a private
security contact, without describing the vulnerability or sharing a proof of concept.
Private reporting must be enabled in GitHub repository settings; this file alone
does not enable it.

Include the affected version or commit, deployment type, prerequisites, expected
and observed behavior, impact and a minimal reproduction using synthetic data.
Avoid live credentials and real responses. Test only installations you own or
have permission to assess. Coordinate public disclosure after maintainers have
assessed the report and users have a fix or mitigation.

## Operating an installation

Deployment owners are responsible for access control, TLS, secrets, backups,
dependency updates and monitoring. Follow the [operations guide](docs/operations.md)
and the [dependency maintenance policy](docs/dependency-maintenance.md).
Dependabot alerts and security updates require separate repository settings.
Rotate exposed credentials at their source; removing them from a commit is not
enough. Report an incident involving your own stored data to your installation's
operator, and report a reproducible software vulnerability to the project.
