import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const base64Key = z.string().refine((value) => {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength === 32 && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}, "Must be a base64-encoded 32-byte key");

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    AUTH_SECRET: z.string().min(32),
    NEXTAUTH_URL: z.url(),
    AUTH_GITHUB_ID: z.string().min(1),
    AUTH_GITHUB_SECRET: z.string().min(1),
    APP_URL: z.url(),
    INNGEST_EVENT_KEY: z.string().min(1),
    INNGEST_SIGNING_KEY: z.string().min(1),
    INNGEST_DEV: z.enum(["0", "1"]).optional(),
    SENTRY_DSN: z.url().optional().or(z.literal("")),
    WEBHOOK_ENCRYPTION_KEY: base64Key,
    FINGERPRINT_SECRET: z.string().min(32),
    TEST_DATABASE_URL: z.url().optional(),
    E2E_PIPELINE_TOKEN: z.string().min(32).optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional().or(z.literal("")),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    APP_URL: process.env.APP_URL,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    INNGEST_DEV: process.env.INNGEST_DEV,
    SENTRY_DSN: process.env.SENTRY_DSN,
    WEBHOOK_ENCRYPTION_KEY: process.env.WEBHOOK_ENCRYPTION_KEY,
    FINGERPRINT_SECRET: process.env.FINGERPRINT_SECRET,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    E2E_PIPELINE_TOKEN: process.env.E2E_PIPELINE_TOKEN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  emptyStringAsUndefined: true,
});
