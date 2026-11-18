# 0.4.0

Form Forge 0.4.0 adds portable form templates. You can download a form's saved
draft as a versioned JSON file and import it as a new unpublished draft in another
workspace or another Form Forge installation.

## Changes since 0.3.0

- **Export:** the form editor's **Export** action downloads the current saved
  draft, not the published version. With unsaved changes, it asks you to save
  first. The file contains a format identifier, a format version and the form
  definition only: no responses, settings, members, webhooks or secrets.
- **Import:** **Forms → Import** validates the file on the server, shows a summary
  and creates the draft only after confirmation. Each import creates a separate
  draft with its own address; existing forms are never changed. Importing
  requires the editor or owner role. Files are limited to 16 MB.
- New administration endpoints for export, preview and import are described in
  the OpenAPI document.
- A simpler project icon, updated dependencies including Next.js 16.4.6, and
  clearer deployment documentation.

## Upgrade from 0.3.0

Back up your installation and keys, update the source and rebuild images for your
public hostname following the [installation guide](README.md). This release has
no new database migrations and no new environment variables. Existing forms,
published versions, responses and webhook behavior are unchanged.

Downgrading to 0.3.0 removes template export and import; forms created by an
import remain ordinary drafts.

## Verification and limitations

This release passed CI, the unit and PostgreSQL integration tests, the browser
tests, and a production build with a smoke test. Template export and import were
also tested through the interface between two separate local installations.

Live OAuth, installation-specific DNS and TLS, production capacity and a full
restore from backup were not tested again for this release; see
[verification](VERIFICATION.md). Release artifacts contain the source, its
provenance and SHA-256 checksums. No prebuilt images are published.
