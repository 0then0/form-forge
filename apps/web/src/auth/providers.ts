import type { NextAuthOptions } from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import GitHubProvider from "next-auth/providers/github";
import GitLabProvider from "next-auth/providers/gitlab";
import GoogleProvider from "next-auth/providers/google";

export type ProviderEnvironment = {
  AUTH_GITHUB_ID: string;
  AUTH_GITHUB_SECRET: string;
  AUTH_GOOGLE_ID?: string | undefined;
  AUTH_GOOGLE_SECRET?: string | undefined;
  AUTH_APPLE_ID?: string | undefined;
  AUTH_APPLE_SECRET?: string | undefined;
  AUTH_GITLAB_ID?: string | undefined;
  AUTH_GITLAB_SECRET?: string | undefined;
  AUTH_CHATGPT_ID?: string | undefined;
  AUTH_CHATGPT_SECRET?: string | undefined;
};

export const createAuthProviders = (
  config: ProviderEnvironment,
): NextAuthOptions["providers"] => {
  const providers: NextAuthOptions["providers"] = [
    GitHubProvider({
      clientId: config.AUTH_GITHUB_ID,
      clientSecret: config.AUTH_GITHUB_SECRET,
    }),
  ];
  const credentials = (id?: string, secret?: string) => {
    if (!!id !== !!secret)
      throw new Error(
        "OAuth providers require both a client ID and client secret",
      );
    return id && secret ? { clientId: id, clientSecret: secret } : undefined;
  };
  const google = credentials(config.AUTH_GOOGLE_ID, config.AUTH_GOOGLE_SECRET);
  if (google) providers.push(GoogleProvider(google));
  const apple = credentials(config.AUTH_APPLE_ID, config.AUTH_APPLE_SECRET);
  if (apple)
    providers.push(
      AppleProvider({ ...apple, checks: ["pkce", "state", "nonce"] }),
    );
  const gitlab = credentials(config.AUTH_GITLAB_ID, config.AUTH_GITLAB_SECRET);
  if (gitlab) providers.push(GitLabProvider(gitlab));
  const chatgpt = credentials(
    config.AUTH_CHATGPT_ID,
    config.AUTH_CHATGPT_SECRET,
  );
  if (chatgpt)
    providers.push({
      id: "chatgpt",
      name: "ChatGPT",
      type: "oauth",
      wellKnown: "https://auth.openai.com/.well-known/openid-configuration",
      clientId: chatgpt.clientId,
      clientSecret: chatgpt.clientSecret,
      client: { token_endpoint_auth_method: "client_secret_post" },
      authorization: { params: { scope: "openid profile email" } },
      checks: ["pkce", "state", "nonce"],
      idToken: true,
      profile(profile: {
        sub: string;
        name?: string;
        email?: string;
        picture?: string;
      }) {
        return {
          id: profile.sub,
          name: profile.name ?? null,
          email: profile.email ?? null,
          image: profile.picture ?? null,
        };
      },
    });
  return providers;
};
