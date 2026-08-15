import "server-only";

import { cache } from "react";
import { getServerSession } from "next-auth";

import { AppError } from "@/lib/errors";
import { authOptions } from "./options";

export const getSession = cache(() => getServerSession(authOptions));

export const requireUser = cache(async () => {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new AppError("UNAUTHORIZED", "Authentication is required", 401);
  }
  return session.user;
});
