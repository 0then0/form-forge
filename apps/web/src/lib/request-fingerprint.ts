export const trustedForwardedFor = (
  headers: Headers,
  trustProxy: boolean,
): string | undefined => {
  if (!trustProxy) return undefined;
  // Choose the trust boundary from server configuration, never from headers.
  // Vercel supplies its own client IP; self-hosting requires our ingress header.
  // Next.js may synthesize X-Forwarded-For, so it is development-only.
  const value =
    process.env.NODE_ENV === "production"
      ? headers.get(
          process.env.VERCEL === "1"
            ? "x-vercel-forwarded-for"
            : "x-form-forge-client-ip",
        )
      : headers.get("x-forwarded-for");
  const address = value?.split(",")[0]?.trim();
  return address && isIP(address) ? address : undefined;
};
import { isIP } from "node:net";
