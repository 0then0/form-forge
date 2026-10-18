(() => {
  if (window.FormForgeEmbed) {
    window.FormForgeEmbed.scan(document);
    return;
  }
  const frames = new Map();
  const destroy = (frame) => {
    const current = frames.get(frame);
    if (!current) return;
    current.dispose();
    window.removeEventListener("message", current.receive);
    frames.delete(frame);
  };
  const mount = (frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    const current = frames.get(frame);
    if (current?.src === frame.src) return;
    destroy(frame);
    let url;
    try {
      url = new URL(frame.src, document.baseURI);
    } catch {
      return;
    }
    if (
      !/^https?:$/.test(url.protocol) ||
      !/^https?:$/.test(location.protocol) ||
      !/^\/f\/[^/]+$/.test(url.pathname)
    )
      return;
    const channel = crypto.randomUUID();
    url.searchParams.set("embed", "1");
    url.searchParams.set("ff_parent_origin", location.origin);
    url.searchParams.set("ff_embed_id", channel);
    const receive = (event) => {
      if (
        event.origin !== url.origin ||
        event.source !== frame.contentWindow ||
        !frame.isConnected
      )
        return;
      const message = event.data;
      if (
        !message ||
        typeof message !== "object" ||
        Array.isArray(message) ||
        message.protocol !== "form-forge/embed" ||
        message.version !== 1 ||
        message.channel !== channel ||
        !["ready", "resize", "submitted"].includes(message.type) ||
        Object.keys(message).some(
          (key) =>
            !["protocol", "version", "channel", "type", "height"].includes(key),
        )
      )
        return;
      if (message.type === "resize") {
        if (
          !Number.isInteger(message.height) ||
          message.height < 1 ||
          message.height > 100000
        )
          return;
        const style = getComputedStyle(frame);
        const inset =
          style.boxSizing === "border-box"
            ? [
                style.borderTopWidth,
                style.borderBottomWidth,
                style.paddingTop,
                style.paddingBottom,
              ].reduce(
                (total, value) => total + (Number.parseFloat(value) || 0),
                0,
              )
            : 0;
        frame.style.height = `${message.height + Math.ceil(inset)}px`;
      } else {
        if ("height" in message) return;
        frame.dispatchEvent(
          new CustomEvent(`formforge:${message.type}`, {
            bubbles: true,
            detail: { iframe: frame },
          }),
        );
      }
    };
    window.addEventListener("message", receive);
    frames.set(frame, {
      receive,
      src: url.href,
      dispose: () =>
        frame.contentWindow?.postMessage(
          {
            protocol: "form-forge/embed",
            version: 1,
            channel,
            type: "dispose",
          },
          url.origin,
        ),
    });
    frame.src = url.href;
  };
  const scan = (root = document) => {
    if (
      root instanceof HTMLIFrameElement &&
      root.hasAttribute("data-form-forge")
    )
      mount(root);
    root.querySelectorAll?.("iframe[data-form-forge]").forEach(mount);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target.hasAttribute("data-form-forge")) mount(record.target);
        else destroy(record.target);
      } else record.addedNodes.forEach(scan);
    }
    for (const frame of frames.keys()) if (!frame.isConnected) destroy(frame);
  });
  window.FormForgeEmbed = {
    scan,
    mount,
    destroy,
    destroyAll() {
      observer.disconnect();
      for (const frame of frames.keys()) destroy(frame);
    },
  };
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-form-forge"],
  });
  scan();
})();
