// @vitest-environment node

import * as Sentry from "@sentry/nextjs";
import { expect, test } from "vitest";

import { sentryDataCollection } from "./sentry-data-collection";

test("keeps sensitive data collection disabled with the Sentry v11 defaults", async () => {
  const client = Sentry.init({
    enabled: false,
    defaultIntegrations: false,
    dataCollection: sentryDataCollection,
  });
  if (!client) throw new Error("Sentry must create a disabled local client");
  try {
    const collection = client.getDataCollectionOptions();
    expect(collection.userInfo).toBe(false);
    expect(collection.cookies).toBe(false);
    expect(collection.httpBodies).toEqual([]);
    expect(collection.databaseQueryData).toBe(false);
    expect(collection.queues).toBe(false);
    expect(collection.genAI).toEqual({ inputs: false, outputs: false });
    expect(collection.graphQL).toEqual({ document: false, variables: false });
  } finally {
    await client.close();
  }
});
