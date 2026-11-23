# 0.6.0

Choose English or Russian for each published form. Hosted and embedded forms use
the same language for validation, local drafts, submission retries and default
closed messages. Saved author text is displayed as written. Form templates carry
the language setting, and older definitions default to English. The submission
API includes stable field error codes alongside its English messages.

## Upgrade from 0.5.0

Back up your installation and keys, then follow the
[installation guide](README.md) to update the source, apply migrations and
rebuild the images. Migration `0007_default_closed_message` changes the database
default for new forms. It preserves existing closed messages. No new environment
variables are required.

Older application versions reject definitions and templates that contain the
language setting. For a rollback with those definitions, restore the
pre-upgrade backup and follow the [verification guide](VERIFICATION.md).

## Verification

The release includes a source archive with provenance and SHA-256 checksums.
