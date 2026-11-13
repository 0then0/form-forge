# Embedding forms

[Project overview](../README.md) · [Documentation](../README.md#documentation)

You can place a published form on another site with an iframe. The form editor
provides a ready-to-copy snippet. Add `?embed=1` to the hosted form URL to use the
compact iframe layout.

## Plain iframe

A plain iframe needs no script and keeps the height you set:

```html
<iframe
  src="https://forms.example.org/f/your-slug?embed=1"
  title="Contact"
  width="100%"
  height="640"
  loading="lazy"
></iframe>
```

## Automatic height

To resize the iframe to its content, add the `data-form-forge` attribute and load
`embed.js` from your Form Forge installation once per page:

```html
<iframe
  data-form-forge
  src="https://forms.example.org/f/your-slug?embed=1"
  title="Contact"
  width="100%"
  height="640"
  loading="lazy"
></iframe>
<script src="https://forms.example.org/embed.js" defer></script>
```

The script handles multiple forms on one page and frames inserted later. The
height follows the form's content, including validation errors, conditional
fields and success or closed messages, and can both grow and shrink.

Visitors can opt into **Save answers on this device** inside an iframe, with the
same Resume, Discard and submission retry controls as a hosted form. Save and
conflict notices also update the automatic height. Answers remain in the form
origin's browser storage and are never sent through embed messages. Browsers may
partition or block third-party storage, so an embedded save may be unavailable
on the hosted page or another embedding site. Storage failures are shown inside
the form and do not prevent ordinary submission. See the [user guide](user-guide.md#saving-unfinished-answers-on-a-device)
for retention and privacy details.

When the script mounts a frame, it adds the parent page's origin and a random
per-frame channel to the iframe URL and reloads the frame once. Mount frames
before visitors start filling them in.

## Events

The script dispatches two events that bubble from the iframe element:

- `formforge:ready`: the form has loaded.
- `formforge:submitted`: the visitor submitted a response.

```js
document.addEventListener("formforge:submitted", (event) => {
  console.log("Submitted from", event.detail.iframe);
});
```

`event.detail` contains only `{ iframe }`. Events never include answers or
response IDs.

## Manual control

`window.FormForgeEmbed` provides methods for single-page applications and other
dynamic pages:

- `scan(container)`: mount every `data-form-forge` iframe inside `container`.
- `mount(iframe)`: mount one iframe.
- `destroy(iframe)`: disconnect one iframe and tell the hosted form to stop
  reporting its height.
- `destroyAll()`: disconnect every frame and stop watching the page.

Frames removed from the page are cleaned up automatically.

## Security

Messages between the page and the iframe are accepted only from the expected
origin, the exact iframe window and its channel, with a known protocol version
and a valid, bounded height. Every outgoing message names an explicit target
origin. When the browser provides a referrer, the hosted form also checks the
parent origin against it.

These checks protect the embed integration only. Hosted forms and the submission
API stay public, and Form Forge has no allowlist of sites that may embed a form.
