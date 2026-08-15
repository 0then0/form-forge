import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getSubmissionDetail } from "@/services/submissions";

export const GET = async (
  _request: Request,
  context: { params: Promise<{ submissionId: string; workspaceSlug: string }> },
) => {
  try {
    const { submissionId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await getSubmissionDetail(workspaceSlug, submissionId),
    });
  } catch (error) {
    return apiError(error);
  }
};
