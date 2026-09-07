import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/services/workspaces", () => ({
  ensurePersonalWorkspace: vi.fn(),
  listUserWorkspaces: vi.fn(),
}));

import AppIndexPage from "./page";

describe("AppIndexPage", () => {
  it("redirects unauthenticated visitors to login instead of throwing", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.redirect.mockImplementation(() => {
      throw new Error("redirected");
    });

    await expect(AppIndexPage()).rejects.toThrow("redirected");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
});
