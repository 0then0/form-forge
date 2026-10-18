import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import {
  deleteSubmission,
  updateSubmissionStatus,
  getSubmissionDetail,
} from "@/services/submissions";
import { submissionDeletionSchema } from "@/lib/submission-mutations";

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

export const DELETE = async (
  request: Request,
  context: { params: Promise<{ submissionId: string; workspaceSlug: string }> },
) => {
  try {
    const { submissionId, workspaceSlug } = await context.params;
    const { confirmation } = submissionDeletionSchema.parse(
      await parseJsonBody(request),
    );
    return NextResponse.json({
      data: await deleteSubmission(workspaceSlug, submissionId, confirmation),
    });
  } catch (error) {
    return apiError(error);
  }
};

export const PATCH = async (
  request: Request,
  context: { params: Promise<{ submissionId: string; workspaceSlug: string }> },
) => {
  try {
    const { submissionId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await updateSubmissionStatus(
        workspaceSlug,
        submissionId,
        await parseJsonBody(request),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
};
