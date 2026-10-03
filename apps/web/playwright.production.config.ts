import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production-smoke.spec.ts",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["html", { outputFolder: "playwright-report/production" }]],
  outputDir: "test-results/production",
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm start --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: databaseUrl ?? "",
      TEST_DATABASE_URL: "",
      E2E_PIPELINE_TOKEN: "",
      APP_URL: "https://forms.example.org",
      NEXTAUTH_URL: "https://forms.example.org",
      NEXT_PUBLIC_APP_URL: "https://forms.example.org",
      AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
      FINGERPRINT_SECRET: crypto.randomUUID() + crypto.randomUUID(),
      WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
      AUTH_GITHUB_ID: crypto.randomUUID(),
      AUTH_GITHUB_SECRET: crypto.randomUUID(),
      INNGEST_EVENT_KEY: crypto.randomUUID(),
      INNGEST_SIGNING_KEY:
        "signkey-prod-" + crypto.randomUUID().replaceAll("-", ""),
      INNGEST_DEV: "0",
      TRUST_PROXY: "1",
      SENTRY_DSN: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
    },
  },
});
