import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

export const edgeEnv = {
  SENTRY_DSN: optionalUrl.parse(process.env.SENTRY_DSN),
};
