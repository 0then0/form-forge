import { cron } from "inngest";

import { deliveryRequested, inngest, submissionReceived } from "./client";
import {
  createDeliveriesForSubmission,
  deliverWebhook,
} from "@/services/deliveries";
import { dispatchPendingOutbox, enqueueDueDeliveries } from "@/services/outbox";

export const processSubmission = inngest.createFunction(
  {
    id: "process-submission",
    retries: 4,
    triggers: submissionReceived,
  },
  async ({ event, step }) => {
    const deliveryCount = await step.run("create-deliveries", () =>
      createDeliveriesForSubmission(
        event.data.submissionId,
        event.data.endpointIds,
      ),
    );
    return { deliveryCount };
  },
);

export const processDelivery = inngest.createFunction(
  {
    id: "process-webhook-delivery",
    retries: 0,
    triggers: deliveryRequested,
  },
  async ({ event, step }) =>
    step.run("deliver-webhook", () => deliverWebhook(event.data.deliveryId)),
);

export const drainOutbox = inngest.createFunction(
  {
    id: "drain-outbox",
    retries: 2,
    triggers: cron("* * * * *"),
  },
  async ({ step }) => {
    await step.run("enqueue-due-deliveries", () => enqueueDueDeliveries());
    return step.run("dispatch-events", () => dispatchPendingOutbox(50));
  },
);

export const inngestFunctions = [
  processSubmission,
  processDelivery,
  drainOutbox,
];
