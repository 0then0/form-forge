import { cron } from "inngest";

import { deliveryRequested, inngest, submissionReceived } from "./client";
import {
  createDeliveriesForSubmission,
  deliverWebhook,
} from "@/services/deliveries";
import { dispatchPendingOutbox } from "@/services/outbox";

export const processSubmission = inngest.createFunction(
  {
    id: "process-submission",
    retries: 4,
    triggers: submissionReceived,
  },
  async ({ event, step }) => {
    const deliveryIds = await step.run("create-deliveries", () =>
      createDeliveriesForSubmission(event.data.submissionId),
    );
    if (deliveryIds.length > 0) {
      await step.sendEvent(
        "enqueue-deliveries",
        deliveryIds.map((deliveryId) =>
          deliveryRequested.create({ deliveryId }),
        ),
      );
    }
    return { deliveryCount: deliveryIds.length };
  },
);

export const processDelivery = inngest.createFunction(
  {
    id: "process-webhook-delivery",
    retries: 4,
    triggers: deliveryRequested,
  },
  async ({ attempt, event, step }) =>
    step.run("deliver-webhook", () =>
      deliverWebhook(event.data.deliveryId, attempt >= 4),
    ),
);

export const drainOutbox = inngest.createFunction(
  {
    id: "drain-outbox",
    retries: 2,
    triggers: cron("* * * * *"),
  },
  async ({ step }) =>
    step.run("dispatch-events", () => dispatchPendingOutbox(50)),
);

export const inngestFunctions = [
  processSubmission,
  processDelivery,
  drainOutbox,
];
