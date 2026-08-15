import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { listFormVersions } from "@/services/forms";

type Context = {
  params: Promise<{ workspaceSlug: string; formId: string }>;
};

export const GET = async (request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    const cursor = rawCursor === null ? undefined : Number(rawCursor);
    if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 1)) {
      throw new AppError("BAD_REQUEST", "Invalid version cursor", 400);
    }
    const page = await listFormVersions(workspaceSlug, formId, cursor);
    return NextResponse.json(
      { data: page.data },
      {
        ...(page.nextCursor === null
          ? {}
          : { headers: { "X-Next-Cursor": String(page.nextCursor) } }),
      },
    );
  } catch (error) {
    return apiError(error);
  }
};
