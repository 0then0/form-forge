import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { listSubmissions } from "@/services/submissions";

import { submissionListQuerySchema as querySchema } from "@/lib/submission-filters";

export const GET = async (
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) => {
  try {
    const { workspaceSlug } = await context.params;
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    return NextResponse.json({
      data: await listSubmissions({ workspaceSlug, ...query }),
    });
  } catch (error) {
    return apiError(error);
  }
};
