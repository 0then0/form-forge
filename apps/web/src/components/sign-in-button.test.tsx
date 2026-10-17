import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { SignInButton } from "./sign-in-button";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

it.each([false, true])(
  "shows only supported sign-in methods when linking is %s",
  (linking) => {
    render(
      <SignInButton
        enabledProviders={["github", "google", "gitlab", "apple", "chatgpt"]}
        linking={linking}
      />,
    );
    const prefix = linking ? "Link" : "Continue with";
    for (const name of ["GitHub", "Google", "GitLab"]) {
      expect(
        screen.getByRole("button", { name: `${prefix} ${name}` }),
      ).toBeEnabled();
    }
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Apple|ChatGPT/ })).toBeNull();
  },
);
