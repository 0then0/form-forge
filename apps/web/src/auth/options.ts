import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthOptions } from "next-auth";
import { createAuthProviders } from "./providers";

import { db } from "@/db/client";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { env } from "@/env";
import { ensurePersonalWorkspace } from "@/services/workspaces";

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(db, {
    accountsTable: accounts,
    sessionsTable: sessions,
    usersTable: users,
    verificationTokensTable: verificationTokens,
  }),
  providers: createAuthProviders(env),
  // Apple's cross-site form_post callback must carry the session (for linking)
  // and OAuth checks. These cookies require HTTPS; CSRF checks remain enabled.
  ...(env.AUTH_APPLE_ID && env.NEXTAUTH_URL.startsWith("https:")
    ? {
        cookies: Object.fromEntries(
          [
            ["sessionToken", "session-token"],
            ["state", "state"],
            ["pkceCodeVerifier", "pkce.code_verifier"],
            ["nonce", "nonce"],
          ].map(([key, name]) => [
            key,
            {
              name: `__Secure-next-auth.${name}`,
              options: {
                httpOnly: true,
                sameSite: "none" as const,
                path: "/",
                secure: true,
                ...(key === "sessionToken" ? {} : { maxAge: 900 }),
              },
            },
          ]),
        ),
      }
    : {}),
  secret: env.AUTH_SECRET,
  session: { strategy: "database" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      await ensurePersonalWorkspace(user);
    },
  },
};
