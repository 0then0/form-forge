import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import { markSubmissionsProcessed } from "@/services/submissions";

export const POST = async (
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) => {
  try {
    const { workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await markSubmissionsProcessed(
        workspaceSlug,
        await parseJsonBody(request),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
};
