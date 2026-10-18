# Using Form Forge

[Project overview](../README.md) · [Documentation](../README.md#documentation)

## Forms and fields

The schema editor offers a live preview, shared validation and conditional field
visibility. Supported fields are short text, long text, email, number, select,
checkbox and date. Checkbox fields can include agreement links with separate link
text and an HTTP/HTTPS URL.

Edit a draft, then publish an immutable version. Compare published versions or
restore one into a new draft revision; existing responses retain their original
version. The administration interface supports system, light and dark themes.

## Sign-in methods and account linking

GitHub remains the required default provider. Enable additional providers by setting
both `AUTH_<PROVIDER>_ID` and `AUTH_<PROVIDER>_SECRET` (`GOOGLE`, `GITLAB`).
Unconfigured methods are shown as unavailable. Register these exact callback paths
under your `NEXTAUTH_URL` origin:

- `/api/auth/callback/github`
- `/api/auth/callback/google`
- `/api/auth/callback/gitlab`

Open **Account** from the header and confirm **Link** for another sign-in method.
NextAuth attaches the verified provider account to the current user, preserving the
same user ID and workspace memberships. Email matches never automatically merge
accounts. When an email is already registered, sign in with the original method first.
A provider identity already attached to a different user cannot be transferred or
merged by this flow. Linking does not change the account's original profile/email.

## Archived forms

Archived forms are available under **Forms → Archived**. Open a form to review its saved draft, all field names and published version history in a read-only view. Restoring a previously
published form makes its existing public URL available again. Workspace owners can
permanently delete an archived form after typing its name; this removes its versions,
submissions, webhook endpoints, delivery history and queued outbox events. Audit logs
and consumed usage reservations remain. Background processing and in-flight webhook deliveries must finish first.

## Intake and response management

Use **Intake and privacy** in the form editor to pause or resume, set a closing time
in **UTC**, set a maximum accepted-response count, and customize the closed message.
These settings take effect immediately for every published version, including old
open tabs. Archive retains its previous behavior and takes the public form offline.
Closing time is checked against the database clock on each new acceptance; it does
not need a frequent cron. Resuming also requires clearing an elapsed time or raising
an exhausted limit. Empty time/maximum means unlimited.

Admission, usage reservation, the lifetime accepted count, response insertion and
outbox share the form's transaction/row lock. Concurrent requests cannot take the
same last place. An identical successful idempotent retry returns the existing
response before the intake checks and consumes no extra place or daily quota.
Deleting a response **does not decrement** the accepted count or return quota.
Migration `0006` initializes the count from existing responses.

The submissions page keeps cursor pagination and offers **from inclusive / until
exclusive** date bounds (UTC), a new/processed filter and PostgreSQL word search.
Search is case-insensitive, accepts 2–100 characters, uses the built-in `simple`
dictionary and searches values, including numeric/boolean values, rather than field
keys. It matches whole words, supports PostgreSQL web-search phrases/operators,
and uses a GIN index; there is no separate search service. List pages are capped
at 100 records. Choose display columns and up to 20 answer-field columns from loaded
pages; form identity remains visible. CSV always includes all matching answer
fields, independently of display-column selection. The new `processing_status`
column is appended after the existing columns, preserving their previous order. Export caps and spreadsheet
formula escaping remain in force. If a response is deleted after an export starts
but before its batch is read, the stream fails instead of silently omitting it. Changing new/processed status never changes
original values, normalized values or historical version; delivery status is separate.

Workspace owners can delete an individual response from its detail page after
entering its full ID. The transaction removes values, metadata, deliveries, attempts,
submission events and associated outbox work; it retains the form's shared webhook
endpoints. Busy worker rows, dispatcher leases or in-flight HTTP deliveries return
`409` with a retry message, and the failed deletion releases every acquired lock.
Deletion audit records contain actor/workspace/form/response IDs and time, never
answer values. Audit history follows the installation's audit/backup lifetime;
this release adds no automatic response or audit retention.

For **30 days from deletion**, the form ID and a keyed HMAC of the idempotency key
are retained, with an expiry, to reject a replay with `409` instead of restoring the
response. No key plaintext, values or visitor identity are kept in that marker.
Expired markers are ignored immediately and removed by recovery cleanup. After
30 days, replaying that key is a new response subject to current intake and quotas;
clients must stop retries after a deletion conflict. Keep `FINGERPRINT_SECRET`
stable: rotating it invalidates both abuse subjects and these deletion markers.

Deletion covers the live Form Forge database. Backup copies and data already
received by external systems must be removed separately. Automatic retention is
outside this stage.

## Workspace access

- **Owner:** all actions, including individual response deletion, webhook endpoint and membership management.
- **Editor:** edit and publish forms, change intake/privacy policy, restore drafts, view/export responses, mark responses new/processed and retry failed deliveries.
- **Viewer:** read-only access to forms, versions, submissions, and deliveries, including CSV export.

Admin operations enforce workspace membership and role permissions on the server. To add a member by email, that person must first sign in to Form Forge; email invitations are not implemented.
