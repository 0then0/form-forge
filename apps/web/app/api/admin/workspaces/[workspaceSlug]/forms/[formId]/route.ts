import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { archiveForm } from "@/services/forms";

export const DELETE = async (
  _request: Request,
  context: { params: Promise<{ formId: string; workspaceSlug: string }> },
) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await archiveForm(workspaceSlug, formId),
    });
  } catch (error) {
    return apiError(error);
  }
};
