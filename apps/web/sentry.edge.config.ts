import * as Sentry from "@sentry/nextjs";

import { edgeEnv } from "@/env-edge";

Sentry.init({
  dsn: edgeEnv.SENTRY_DSN,
  enabled: Boolean(edgeEnv.SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
});
