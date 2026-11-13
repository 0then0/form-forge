# Using Form Forge

[Project overview](../README.md) · [Documentation](../README.md#documentation)

This guide covers the administration interface: building and publishing forms,
controlling intake, managing responses and sharing a workspace.

## Forms and fields

The schema editor shows a live preview and uses the same validation as the
public form. Supported field types are short text, long text, email, number,
select, checkbox and date. Fields can be shown or hidden based on earlier
answers. Checkbox fields can include agreement links, each with its own link
text and an HTTP or HTTPS URL.

You edit a draft and publish it as an immutable version. You can compare
published versions and restore any of them into a new draft. Existing responses
always keep a reference to the version they were submitted against.

The interface supports system, light and dark themes.

## Saving unfinished answers on a device

Visitors to a hosted or embedded form can enable **Save answers on this device**.
Saving is voluntary and off by default. Enabling it saves the current partial
answers, including incomplete fields; it does not submit them. Wait for the
**Saved on this device at** confirmation before leaving. Changes are saved after
a short delay, so the last characters can be lost if the browser crashes before
the write finishes.

On a later visit, the form shows the saved date and asks the visitor to choose
**Resume** or **Discard** before applying any answers. Resume keeps saving active.
Discard or a confirmed successful submission removes that form version's local
answers and retry state. Disabling saving removes its persistent local copy;
an unresolved attempt remains available in the current page, with its key and
payload digest kept in the tab's session state for safe retries. A storage error
is shown on the form; ordinary filling and submission remain available.

Each save belongs to one deployment origin, form and exact immutable published
version. A new published version does not import answers from an older version;
the visitor can delete the incompatible save. Hidden conditional answers are
removed according to the form's existing visibility rules. Local saving does
not reopen paused, closed, full or archived forms.

If another tab changes the same save, automatic saving pauses and the visitor
must choose which answers to keep. Changes are never automatically merged.
Discard or successful submission in another tab invalidates the local save.
Browser storage does not provide strict transactions between tabs.

Before submitting, the form fixes the application payload and idempotency key
for that attempt. If the server may have accepted the response but its reply was
lost, **Retry original attempt** repeats those values and that key. Editing
answers cannot silently change the original attempt. **Start a new attempt**
requires confirmation because the earlier response may already exist. Persistent
retry recovery is available only when saving was enabled and the attempt was
successfully written to browser storage.

The existing tab-scoped submission key remains in `sessionStorage`, together
with a SHA-256 digest that prevents changed answers from reusing that key.
This session state contains no answers. Without local-saving consent, answers
and the complete retry payload stay in memory and cannot be recovered after
closing the tab. An older session key without a payload binding requires an
explicit new-attempt confirmation.

## Sign-in methods and account linking

GitHub sign-in is required. Google and GitLab are optional: enable each by
setting both `AUTH_<PROVIDER>_ID` and `AUTH_<PROVIDER>_SECRET`, with `GOOGLE` or
`GITLAB` as the provider name. Methods that are not configured are shown as
unavailable on the sign-in page. Register these callback paths under your
`NEXTAUTH_URL` origin:

- `/api/auth/callback/github`
- `/api/auth/callback/google`
- `/api/auth/callback/gitlab`

To add another sign-in method to your account, open **Account** from the header
and choose **Link**. The new provider account is attached to your current user,
which keeps the same user ID and workspace memberships.

Accounts are never merged automatically by email address. If an email address is
already registered, sign in with the original method first and link the other
method from **Account**. A provider identity that is already attached to another
user cannot be moved by linking. Linking does not change the account's original
profile or email address.

## Archived forms

Archived forms are listed under **Forms → Archived**. Open one to review its
saved draft, field names and published version history in read-only mode.
Restoring a form that was published before makes its public URL available again.

Workspace owners can permanently delete an archived form after typing its name.
This removes its versions, responses, webhook endpoints, delivery history and
queued outbox events. Audit logs and consumed daily quota remain. Background
processing and in-progress webhook deliveries for the form must finish first.

## Intake controls

Open **Intake and privacy** in the form editor to:

- pause or resume the form;
- set a closing time, in UTC;
- set a maximum number of accepted responses;
- customize the message shown when the form is closed.

Leave the closing time or maximum empty for no limit. These settings take effect
immediately for every published version, including pages that visitors already
have open. Archiving a form also takes it offline.

The closing time is checked against the database clock for each new response, so
no scheduled job is needed. To resume a form after its closing time has passed or
its limit was reached, also clear the time or raise the limit.

Two visitors can never take the same last place: admission, quota, the accepted
count and the response itself are written in one transaction under a lock on the
form. Retrying a successful submission with the same idempotency key returns the
existing response and does not take another place or consume quota. Deleting a
response does not lower the accepted count or return quota.

## Privacy and source metadata

Each form controls whether it collects source metadata: a visitor ID, the
referrer, UTM parameters and the user agent. Collection is off by default for new
forms. When it is off, the hosted form does not create a persistent visitor ID or
send this context, and the server does not store it even if an API client sends
it. Turning collection off does not erase metadata saved earlier.

Unfinished answers are stored only in the visitor's browser after opt-in, never
as partial responses on the server. Local saves expire after seven days. Each
record is limited to 256 KiB, with at most ten Form Forge draft records per
browser storage area; cleanup touches only Form Forge's own draft keys. The
record includes the form and version identity, timestamps, expiry, answers,
revision, writer identity and any frozen submission attempt needed for retry.
The normal submit workflow is the only path that sends these answers to the
server.

Browser storage is not encrypted by Form Forge and can be read by scripts on
the same origin or other people using that browser profile. Clearing browser
data, private browsing, storage restrictions or eviction can remove saves. An
embedded form uses the browser's storage area for its own origin; browsers may
partition or block it on other sites, so a save in an embed may not be visible
on the hosted page. A storage error never means a draft or retry was safely
saved. Local saving provides no account, cross-device sync or transfer link.

## Responses

The **Submissions** page lists responses with cursor pagination, up to 100 per
page. You can filter by:

- date, with an inclusive start and exclusive end, in UTC;
- processing status, new or processed;
- answer text.

Answer search is case-insensitive, accepts 2 to 100 characters and matches whole
words in answer values, including numbers and booleans, but not field keys. It
supports PostgreSQL web-search syntax such as quoted phrases and `-word`, and
uses a PostgreSQL GIN index; no separate search service is required.

You can choose which columns to display, including up to 20 answer fields. The
form name always stays visible.

Editors and owners can mark a response as new or processed. This status is
independent of delivery status and never changes the submitted values or the
version the response belongs to.

### CSV export

CSV export uses the same filters as the list, but always includes every answer
field, regardless of which columns are displayed. Columns are `submission_id`,
`form`, `version`, `received_at`, `delivery_status`, one column per answer field,
and `processing_status`. An export is limited to 10,000 responses and 500
distinct field keys. Values that a spreadsheet could interpret as formulas are
escaped.

The export captures the matching responses when it starts, so new responses and
later status changes do not change an export in progress. If a selected response
is deleted before the export reads it, the export fails instead of silently
omitting it.

### Deleting a response

Workspace owners can delete a single response from its detail page after typing
its full ID. Deletion removes the answers, metadata, deliveries, delivery
attempts, events and queued outbox work for that response. The form's webhook
endpoints are kept. If a worker is processing the response at that moment, the
request returns `409` and can be retried shortly; a failed deletion changes
nothing.

The audit log records who deleted which response and when, but not its answers.

For 30 days after deletion, Form Forge keeps the form ID and a keyed hash of the
response's idempotency key. A client that replays the same key during this period
receives `409` instead of recreating the response. The marker contains no answers,
original key or visitor identity. After 30 days, the same key creates a new
response, so API clients must stop retrying after a deletion conflict. Keep
`FINGERPRINT_SECRET` stable: rotating it invalidates these markers and the
abuse-protection identities.

Deletion applies to the live database only. Remove copies in backups and in
systems that already received the data through webhooks separately. Form Forge
does not delete responses or audit records automatically.

## Workspace access

- **Owner:** all actions, including deleting responses and managing webhook
  endpoints and members.
- **Editor:** edit and publish forms, change intake and privacy settings, restore
  drafts, view and export responses, mark responses new or processed, and retry
  failed deliveries.
- **Viewer:** read-only access to forms, versions, responses and deliveries,
  including CSV export.

The server checks workspace membership and role for every administrative action.
Your first sign-in creates a personal workspace. To add a member by email, that
person must sign in to Form Forge once first; email invitations are not
available.
