import { z } from "zod";

import { AppError } from "./errors";

/**
 * Guards IDs that cross an HTTP or server-component boundary before they are
 * handed to PostgreSQL. Invalid UUID input should be a client error, not a
 * database cast error.
 */
export const requireUuidParam = (value: string, label: string): string => {
  if (z.uuid().safeParse(value).success) return value;
  throw new AppError("BAD_REQUEST", `Invalid ${label}`, 400);
};
