export const trustedForwardedFor = (
  headers: Headers,
  trustProxy: boolean,
): string | undefined => {
  if (!trustProxy) return undefined;
  // Next.js may synthesize X-Forwarded-For. Only the ingress writes our
  // dedicated production header; direct requests without it fail closed.
  const value =
    process.env.NODE_ENV === "production"
      ? headers.get("x-form-forge-client-ip")
      : headers.get("x-forwarded-for");
  const address = value?.split(",")[0]?.trim();
  return address && isIP(address) ? address : undefined;
};
import { isIP } from "node:net";
