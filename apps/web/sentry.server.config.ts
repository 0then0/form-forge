import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection } from "@/lib/sentry-data-collection";

import { env } from "@/env";

Sentry.init({
  dsn: env.SENTRY_DSN || undefined,
  enabled: Boolean(env.SENTRY_DSN),
  dataCollection: sentryDataCollection,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      if (event.request.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
    }
    return event;
  },
});
