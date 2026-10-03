// @vitest-environment node
import { describe, expect, test } from "vitest";
import { assertProductionConfig } from "./production-config";

const valid = () => ({
  AUTH_SECRET: "a-production-secret-with-at-least-32-characters",
  FINGERPRINT_SECRET: "another-production-secret-at-least-32-characters",
  APP_URL: "https://forms.example.org",
  NEXTAUTH_URL: "https://forms.example.org",
  NEXT_PUBLIC_APP_URL: "https://forms.example.org",
  AUTH_GITHUB_ID: "oauth-id",
  AUTH_GITHUB_SECRET: "oauth-secret",
  INNGEST_EVENT_KEY: "cloud-key",
  INNGEST_SIGNING_KEY: "signkey-prod-key",
  INNGEST_DEV: "0",
  TRUST_PROXY: "1",
});

describe("production configuration", () => {
  test("accepts public configuration and empty disabled test variables", () => {
    expect(() =>
      assertProductionConfig({
        ...valid(),
        TEST_DATABASE_URL: "",
        E2E_PIPELINE_TOKEN: "",
      }),
    ).not.toThrow();
  });
  test.each([
    { INNGEST_DEV: "1" },
    { TRUST_PROXY: "0" },
    { INNGEST_EVENT_KEY: "local" },
    { AUTH_GITHUB_SECRET: "ci-placeholder" },
    { APP_URL: "http://localhost:3000" },
    { NEXTAUTH_URL: "https://other.example.org" },
    { TEST_DATABASE_URL: "postgres://localhost/test" },
    { E2E_PIPELINE_TOKEN: "secret-token" },
  ])(
    "rejects unsafe runtime overrides without disclosing their values: %j",
    (overrides) => {
      expect(() =>
        assertProductionConfig({ ...valid(), ...overrides }),
      ).toThrow("Invalid production configuration");
      try {
        assertProductionConfig({ ...valid(), ...overrides });
      } catch (error) {
        expect(String(error)).not.toContain(Object.values(overrides)[0]);
      }
    },
  );
});
