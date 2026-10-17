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
