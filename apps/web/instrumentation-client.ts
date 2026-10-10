import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection } from "@/lib/sentry-data-collection";

import { env } from "@/env";

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  enabled: Boolean(env.NEXT_PUBLIC_SENTRY_DSN),
  dataCollection: sentryDataCollection,
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
