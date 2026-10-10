import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));

import MarketingPage from "./page";

describe("MarketingPage", () => {
  it("offers sign-in and sends guests to login", async () => {
    mocks.getSession.mockResolvedValue(null);

    render(await MarketingPage());

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.getByRole("link", { name: "Open the workspace" }),
    ).toHaveAttribute("href", "/login");
  });

  it("sends signed-in users directly to their workspace", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });

    render(await MarketingPage());

    expect(
      screen.queryByRole("link", { name: "Sign in" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open workspace" }),
    ).toHaveAttribute("href", "/app");
    expect(
      screen.getByRole("link", { name: "Open the workspace" }),
    ).toHaveAttribute("href", "/app");
  });
});
