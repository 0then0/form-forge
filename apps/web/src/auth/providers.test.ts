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
      AUTH_APPLE_ID: "apple",
      AUTH_APPLE_SECRET: "secret",
      AUTH_GITLAB_ID: "gitlab",
      AUTH_GITLAB_SECRET: "secret",
      AUTH_CHATGPT_ID: "oaiapp_client",
      AUTH_CHATGPT_SECRET: "secret",
    });
    expect(providers.map(({ id }) => id)).toEqual([
      "github",
      "google",
      "apple",
      "gitlab",
      "chatgpt",
    ]);
    for (const provider of providers) {
      if (provider.type === "oauth") {
        expect(provider.allowDangerousEmailAccountLinking).not.toBe(true);
        expect(provider.options?.allowDangerousEmailAccountLinking).not.toBe(
          true,
        );
      }
    }
    const chatgpt = providers.find(({ id }) => id === "chatgpt");
    expect(chatgpt).toMatchObject({
      wellKnown: "https://auth.openai.com/.well-known/openid-configuration",
      checks: ["pkce", "state", "nonce"],
      idToken: true,
    });
  });

  it("does not register unconfigured methods and refuses partial credentials", () => {
    expect(createAuthProviders(config).map(({ id }) => id)).toEqual(["github"]);
    expect(() =>
      createAuthProviders({ ...config, AUTH_GOOGLE_ID: "google" }),
    ).toThrow("both a client ID and client secret");
  });
});
