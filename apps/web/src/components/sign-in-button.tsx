"use client";

import { Button } from "@form-forge/ui";
import { LogIn } from "lucide-react";
import { signIn } from "next-auth/react";

export const SignInButton = () => (
  <Button
    className="w-full"
    onClick={() => void signIn("github", { callbackUrl: "/app" })}
  >
    <LogIn aria-hidden="true" className="size-4" />
    Continue with GitHub
  </Button>
);
