import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const e2ePipelineToken = process.env.E2E_PIPELINE_TOKEN ?? crypto.randomUUID();
process.env.E2E_PIPELINE_TOKEN = e2ePipelineToken;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          ...(testDatabaseUrl
            ? {
                env: {
                  DATABASE_URL: testDatabaseUrl,
                  E2E_PIPELINE_TOKEN: e2ePipelineToken,
                  TEST_DATABASE_URL: testDatabaseUrl,
                },
              }
            : {}),
          reuseExistingServer: false,
          url: "http://localhost:3000",
        },
      }),
});
