import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

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
  providers: [
    GitHubProvider({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
    }),
  ],
  secret: env.AUTH_SECRET,
  session: { strategy: "database" },
  pages: { signIn: "/login" },
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
