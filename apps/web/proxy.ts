import { NextResponse } from "next/server";

import { isAdminRequestOriginAllowed } from "@/auth/request-origin";

export const config = { matcher: "/api/admin/:path*" };

export function proxy(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method))
    return NextResponse.next();
  if (!isAdminRequestOriginAllowed(request)) {
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
