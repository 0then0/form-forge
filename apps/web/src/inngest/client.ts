import { eventType, Inngest, staticSchema } from "inngest";

import { env } from "@/env";

export const submissionReceived = eventType("form-forge/submission.received", {
  schema: staticSchema<{ submissionId: string }>(),
});

export const deliveryRequested = eventType("form-forge/delivery.requested", {
  schema: staticSchema<{ deliveryId: string }>(),
});

export const inngest = new Inngest({
  eventKey: env.INNGEST_EVENT_KEY,
  id: "form-forge",
});
