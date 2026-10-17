// @vitest-environment node

import type { NextApiRequest, NextApiResponse } from "next";
import NextAuth from "next-auth";
import type { AdapterUser } from "next-auth/adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapter: {
    getSessionAndUser: vi.fn(),
    getUserByAccount: vi.fn(),
    getUserByEmail: vi.fn(),
    linkAccount: vi.fn(),
    createUser: vi.fn(),
    createSession: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    deleteSession: vi.fn(),
  },
  ensureWorkspace: vi.fn(),
}));
vi.mock("@auth/drizzle-adapter", () => ({
  DrizzleAdapter: () => mocks.adapter,
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/services/workspaces", () => ({
  ensurePersonalWorkspace: mocks.ensureWorkspace,
}));
import { authOptions } from "./options";

const owner: AdapterUser = {
  id: "original-user",
  name: "Original",
  email: "same@example.com",
  emailVerified: null,
};
const session = {
  sessionToken: "active-session",
  userId: owner.id,
  expires: new Date(Date.now() + 86_400_000),
};

// Exercise NextAuth's public callback handler and our session/events configuration.
// The OAuth exchange is stubbed; production provider checks are tested separately.
const callback = async (signedIn: boolean) => {
  const responseHeaders = new Map<string, unknown>();
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn((name: string, value: unknown) => {
      responseHeaders.set(name, value);
      return res;
    }),
    getHeader: (name: string) => responseHeaders.get(name),
    end: vi.fn(),
    send: vi.fn(),
    json: vi.fn(),
  };
  await NextAuth(
    {
      method: "GET",
      query: { nextauth: ["callback", "google"], code: "verified-code" },
      headers: { host: "localhost:3000" },
      cookies: signedIn
        ? { "next-auth.session-token": session.sessionToken }
        : {},
    } as unknown as NextApiRequest,
    res as unknown as NextApiResponse,
    {
      ...authOptions,
      logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      providers: [
        {
          id: "google",
          name: "Google",
          type: "oauth",
          clientId: "test",
          clientSecret: "test",
          authorization: "https://provider.example/authorize",
          checks: [],
          token: {
            url: "https://provider.example/token",
            request: async () => ({
              tokens: { access_token: "verified-token", token_type: "bearer" },
            }),
          },
          userinfo: {
            url: "https://provider.example/user",
            request: async () => ({
              sub: "google-identity",
              email: owner.email,
            }),
          },
          profile: (profile: { sub: string; email: string }) => ({
            id: profile.sub,
            email: profile.email,
            name: "Google profile",
          }),
        },
      ],
    },
  );
  return String(responseHeaders.get("Location"));
};

describe("account linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adapter.getSessionAndUser.mockResolvedValue({ session, user: owner });
    mocks.adapter.getUserByAccount.mockResolvedValue(null);
    mocks.adapter.getUserByEmail.mockResolvedValue(owner);
    mocks.adapter.linkAccount.mockResolvedValue(undefined);
  });

  it("links Google from the signed-in GitHub account without creating a user or workspace", async () => {
    expect(await callback(true)).toBe("http://localhost:3000");
    expect(mocks.adapter.linkAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        providerAccountId: "google-identity",
        userId: owner.id,
      }),
    );
    expect(mocks.adapter.createUser).not.toHaveBeenCalled();
    expect(mocks.ensureWorkspace).not.toHaveBeenCalled();
  });

  it("rejects an email match without an authenticated session", async () => {
    expect(await callback(false)).toContain("OAuthAccountNotLinked");
    expect(mocks.adapter.linkAccount).not.toHaveBeenCalled();
    expect(mocks.adapter.createSession).not.toHaveBeenCalled();
  });

  it("does not transfer a provider identity owned by a different account", async () => {
    mocks.adapter.getUserByAccount.mockResolvedValue({
      ...owner,
      id: "different-user",
    });
    expect(await callback(true)).toContain("OAuthAccountNotLinked");
    expect(mocks.adapter.linkAccount).not.toHaveBeenCalled();
  });

  it("signs in through the linked method with the same user ID", async () => {
    mocks.adapter.getUserByAccount.mockResolvedValue(owner);
    mocks.adapter.createSession.mockResolvedValue(session);
    expect(await callback(false)).toBe("http://localhost:3000");
    expect(mocks.adapter.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner.id }),
    );
    expect(mocks.adapter.createUser).not.toHaveBeenCalled();
    expect(mocks.ensureWorkspace).not.toHaveBeenCalled();
  });
});
