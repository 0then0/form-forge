import { NextResponse } from "next/server";

import { env } from "@/env";

export const config = { matcher: "/api/admin/:path*" };

export function proxy(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method))
    return NextResponse.next();
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // Apple's form_post needs SameSite=None session cookies. Keep browser-driven
  // admin mutations bound to our own origin; OAuth callbacks use NextAuth checks.
  // Non-browser API clients without Origin/Fetch Metadata remain supported.
  if (
    (origin !== null && origin !== new URL(env.NEXTAUTH_URL).origin) ||
    site === "cross-site" ||
    (origin === null && site === "same-site")
  ) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Admin actions must originate from this application",
          requestId: crypto.randomUUID(),
        },
      },
      { status: 403 },
    );
  }
  return NextResponse.next();
}
