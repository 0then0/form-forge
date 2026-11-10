# Releasing

[Project overview](../README.md) · [Documentation](../README.md#documentation)

This page is for maintainers. Contributors do not need to create tags or run
production workflows.

## Versions

The release version is stored in [`deploy/VERSION`](../deploy/VERSION). The
application and workspace packages keep the internal npm version `0.0.0` and are
not published. Versions with a hyphen, such as `0.3.0-rc.1`, are published as
prereleases.

## Prepare a release

1. Make sure CI passes on the revision you want to release and run the
   [verification checks](../deploy/VERIFICATION.md), including the automated
   acceptance test for changes to deployment, scheduling or delivery.
2. Update [`CHANGELOG.md`](../CHANGELOG.md): move the entries from
   **Unreleased** into a new version section and update the comparison links.
3. Update `deploy/VERSION` and the image tags in `deploy/compose.yaml`.
4. Write [`deploy/RELEASE_NOTES.md`](../deploy/RELEASE_NOTES.md). Describe new
   migrations, upgrade steps and downgrade limits. Links to `README.md` and
   `VERIFICATION.md` are rewritten to point at the released revision.
5. Merge these changes through a pull request.

## Publish

Push a tag named `v` followed by the contents of `deploy/VERSION`:

```sh
git tag v0.3.0
git push origin v0.3.0
```

The [release workflow](../.github/workflows/release.yml) checks that the tag
matches `deploy/VERSION`, packages the committed source with
`deploy/package.py`, verifies the checksums, uploads
`form-forge-<version>.tar.gz`, `SOURCE.json` and `SHA256SUMS` to a draft GitHub
Release and then publishes it. It uses GitHub's job token and needs no other
credentials.

A release does not deploy the application or migrate any database. No prebuilt
images are published; each installation builds images for its own hostname.

## Package locally

To build the same source archive locally, run from a clean checkout:

```sh
python3 deploy/package.py
```

The script refuses a checkout with uncommitted changes and includes only tracked
regular files. Running it again on the same commit produces identical checksums.
It does not commit, tag, push or publish anything.

## Production workflows

The Netlify installation uses two manually started workflows, described in the
[Netlify guide](../deploy/NETLIFY.md):

- **Database migrations** applies committed migrations using the
  `NEON_MIGRATION_DATABASE_URL` secret.
- **Deploy production** calls the Netlify build hook stored in
  `NETLIFY_BUILD_HOOK`.

Neither runs on push or as part of a release.
