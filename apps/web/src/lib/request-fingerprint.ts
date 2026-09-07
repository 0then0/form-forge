export const trustedForwardedFor = (
  headers: Headers,
  trustProxy: boolean,
): string | undefined => {
  if (!trustProxy) return undefined;
  const address = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return address || undefined;
};
