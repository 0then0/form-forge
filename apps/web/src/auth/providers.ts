import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GitLabProvider from "next-auth/providers/gitlab";
import GoogleProvider from "next-auth/providers/google";

export type ProviderEnvironment = {
  AUTH_GITHUB_ID: string;
  AUTH_GITHUB_SECRET: string;
  AUTH_GOOGLE_ID?: string | undefined;
  AUTH_GOOGLE_SECRET?: string | undefined;
  AUTH_GITLAB_ID?: string | undefined;
  AUTH_GITLAB_SECRET?: string | undefined;
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
  const gitlab = credentials(config.AUTH_GITLAB_ID, config.AUTH_GITLAB_SECRET);
  if (gitlab) providers.push(GitLabProvider(gitlab));
  return providers;
};
