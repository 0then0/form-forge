"use client";

import { Button } from "@form-forge/ui";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export const SignOutButton = () => (
  <Button
    aria-label="Sign out"
    onClick={() => void signOut({ callbackUrl: "/" })}
    size="icon"
    variant="ghost"
  >
    <LogOut className="size-4" />
  </Button>
);
