import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { restoreArchivedForm } from "@/services/forms";

export const POST = async (
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string; formId: string }> },
) => {
  try {
    const { workspaceSlug, formId } = await context.params;
    return NextResponse.json({
      data: await restoreArchivedForm(workspaceSlug, formId),
    });
  } catch (error) {
    return apiError(error);
  }
};
