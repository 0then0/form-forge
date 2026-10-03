import { isIP } from "node:net";
import { z } from "zod";

const publicHttpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.hostname !== "localhost" &&
    !url.hostname.endsWith(".localhost") &&
    !isIP(url.hostname.replace(/^\[|\]$/g, ""))
  );
}, "Use a public HTTPS hostname");
const credential = z
  .string()
  .min(1)
  .refine(
    (value) => !/^(local$|test[-_]|ci[-_]|replace[-_]|example)/i.test(value),
    "Development placeholders are not production credentials",
  );

const configuration = z
  .object({
    AUTH_SECRET: credential.min(32),
    FINGERPRINT_SECRET: credential.min(32),
    APP_URL: publicHttpsUrl,
    NEXTAUTH_URL: publicHttpsUrl,
    NEXT_PUBLIC_APP_URL: publicHttpsUrl,
    AUTH_GITHUB_ID: credential,
    AUTH_GITHUB_SECRET: credential,
    INNGEST_EVENT_KEY: credential,
    INNGEST_SIGNING_KEY: credential,
    INNGEST_DEV: z.literal("0"),
    TRUST_PROXY: z.literal("1"),
    TEST_DATABASE_URL: z.undefined().optional(),
    E2E_PIPELINE_TOKEN: z.undefined().optional(),
  })
  .refine(
    (value) =>
      value.APP_URL === value.NEXTAUTH_URL &&
      value.APP_URL === value.NEXT_PUBLIC_APP_URL,
    "Application URLs must match",
  );

export const assertProductionConfig = (
  input: Record<string, string | undefined>,
) => {
  const result = configuration.safeParse(
    Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== ""),
    ),
  );
  if (!result.success) {
    // Never print values or the full Zod input: credentials may be present.
    const fields = [
      ...new Set(
        result.error.issues.map(
          (issue) => issue.path.join(".") || "application URLs",
        ),
      ),
    ];
    throw new Error(`Invalid production configuration: ${fields.join(", ")}`);
  }
};
