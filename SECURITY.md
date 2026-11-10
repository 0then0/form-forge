# Security policy

## Supported versions

Security fixes are made for the latest stable release. Older releases and
prereleases are not maintained separately; upgrade to the latest stable version
when a fix is available. See the
[releases](https://github.com/0then0/form-forge/releases) and
[CHANGELOG.md](CHANGELOG.md).

There is no guaranteed response or fix time.

## Reporting a vulnerability

Please do not disclose vulnerabilities, credentials or response data in public
issues, pull requests or discussions.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/0then0/form-forge/security/advisories/new)
(**Security → Advisories → Report a vulnerability**). If that option is not
available, contact [the maintainer](https://github.com/0then0) through a private
contact method listed on their profile. If you cannot find one, open an issue
asking for a private security contact, without describing the vulnerability.

Please include:

- the affected version or commit and deployment type;
- prerequisites, expected and observed behavior, and impact;
- a minimal reproduction using synthetic data.

Do not use live credentials or real responses. Test only installations you own or
have permission to test. We will coordinate public disclosure with you once the
report has been assessed and a fix or mitigation is available.

## Running an installation

Operators are responsible for access control, TLS, secrets, backups, dependency
updates and monitoring of their installation. Follow the
[operations guide](docs/operations.md). If a credential is exposed, rotate it at
its source; removing it from a commit is not enough.

Report incidents involving data stored in a particular installation to that
installation's operator. Report reproducible vulnerabilities in the software to
this project.
