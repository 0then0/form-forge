import { env } from "@/env";

// Shared by browser admin mutations and every MCP transport method.
export const isAdminRequestOriginAllowed = (request: Request) => {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return !(
    (origin !== null && origin !== new URL(env.NEXTAUTH_URL).origin) ||
    site === "cross-site" ||
    (origin === null && site === "same-site")
  );
};
