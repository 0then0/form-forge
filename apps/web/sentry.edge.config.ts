import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection } from "@/lib/sentry-data-collection";

import { edgeEnv } from "@/env-edge";

Sentry.init({
  dsn: edgeEnv.SENTRY_DSN,
  enabled: Boolean(edgeEnv.SENTRY_DSN),
  dataCollection: sentryDataCollection,
  tracesSampleRate: 0.1,
});
