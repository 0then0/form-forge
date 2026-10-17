import { describe, expect, it } from "vitest";
import { createAuthProviders } from "./providers";

const config = {
  AUTH_GITHUB_ID: "github",
  AUTH_GITHUB_SECRET: "github-secret",
};

describe("sign-in provider configuration", () => {
  it("enables configured providers and keeps email account linking disabled", () => {
    const providers = createAuthProviders({
      ...config,
      AUTH_GOOGLE_ID: "google",
      AUTH_GOOGLE_SECRET: "secret",
      AUTH_GITLAB_ID: "gitlab",
      AUTH_GITLAB_SECRET: "secret",
    });
    expect(providers.map(({ id }) => id)).toEqual([
      "github",
      "google",
      "gitlab",
    ]);
    for (const provider of providers) {
      if (provider.type === "oauth") {
        expect(provider.allowDangerousEmailAccountLinking).not.toBe(true);
        expect(provider.options?.allowDangerousEmailAccountLinking).not.toBe(
          true,
        );
      }
    }
  });

  it("does not register unconfigured methods and refuses partial credentials", () => {
    expect(createAuthProviders(config).map(({ id }) => id)).toEqual(["github"]);
    expect(() =>
      createAuthProviders({ ...config, AUTH_GOOGLE_ID: "google" }),
    ).toThrow("both a client ID and client secret");
  });

  it("does not re-enable removed providers through legacy configuration", () => {
    const legacy = {
      ...config,
      AUTH_APPLE_ID: "old-apple-client",
      AUTH_APPLE_SECRET: "old-secret",
      AUTH_CHATGPT_ID: "old-chatgpt-client",
      AUTH_CHATGPT_SECRET: "old-secret",
    };
    expect(createAuthProviders(legacy).map(({ id }) => id)).toEqual(["github"]);
  });
});
