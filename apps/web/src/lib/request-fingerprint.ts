export const trustedForwardedFor = (
  headers: Headers,
  trustProxy: boolean,
): string | undefined => {
  if (!trustProxy) return undefined;
  // Choose the trust boundary from server configuration, never from headers.
  // Netlify supplies its own client IP; self-hosting requires our ingress header.
  // SITE_ID is available in both builds and Functions; NETLIFY is build-only.
  // Next.js may synthesize X-Forwarded-For, so it is development-only.
  const value =
    process.env.NODE_ENV === "production"
      ? headers.get(
          process.env.SITE_ID
            ? "x-nf-client-connection-ip"
            : "x-form-forge-client-ip",
        )
      : headers.get("x-forwarded-for");
  const address = value?.split(",")[0]?.trim();
  return address && isIP(address) ? address : undefined;
};
import { isIP } from "node:net";
