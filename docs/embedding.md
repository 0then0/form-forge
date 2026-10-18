# Embedding forms

[Project overview](../README.md) · [Documentation](../README.md#documentation)

Plain iframe snippets remain supported. For automatic height, add `data-form-forge`
and load the script once (multiple frames and dynamically inserted frames work):

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

The script adds an exact parent origin and a random per-frame channel to the iframe
URL and reloads it once when mounted. Mount frames before visitors begin filling
them. ResizeObserver measures the compact content, including field errors,
conditional fields and success/closed messages, so height can grow and shrink.
Messages require the expected form origin, the exact `iframe.contentWindow`, the
channel, protocol/version and a valid bounded integer height. Every outgoing
message uses an explicit target origin. The hosted bridge also checks the parent
origin against the document referrer when one is available.

Listen on a frame or an ancestor for bubbling `formforge:ready` and
`formforge:submitted` events. `event.detail` contains only `{ iframe }`, with no
answer values or response identifiers. Removing frames detaches their message
handlers automatically. Explicit disposal also sends a validated control message
to disconnect the hosted observer. Use `window.FormForgeEmbed.destroy(iframe)` for explicit
disposal, `scan(container)`/`mount(iframe)` for manual mounting, and `destroyAll()`
to disconnect the observer and all handlers when disposing an entire integration.
Without the script/marker, the iframe keeps its specified fixed height.

Hosted forms and the submit API remain public. Message-origin checks are an embed
integration boundary; they do not protect the public API against direct requests.
This release does not add an embed-origin allowlist or a claim of API protection.
