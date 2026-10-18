import { eventType, Inngest, staticSchema } from "inngest";

import { env } from "@/env";

export const submissionReceived = eventType("form-forge/submission.received", {
  schema: staticSchema<{ endpointIds?: string[]; submissionId: string }>(),
});

export const deliveryRequested = eventType("form-forge/delivery.requested", {
  schema: staticSchema<{ deliveryId: string }>(),
});

export const inngest = new Inngest({
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(2_000)])
        : AbortSignal.timeout(2_000),
    }),
  eventKey: env.INNGEST_EVENT_KEY,
  id: "form-forge",
});
