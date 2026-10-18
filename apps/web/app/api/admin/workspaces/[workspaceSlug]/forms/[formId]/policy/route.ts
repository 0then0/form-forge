import { NextResponse } from "next/server";
import { apiError, parseJsonBody } from "@/lib/api";
import { updateFormPolicy } from "@/services/forms";

export const PUT = async (
  request: Request,
  context: { params: Promise<{ formId: string; workspaceSlug: string }> },
) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await updateFormPolicy(
        workspaceSlug,
        formId,
        await parseJsonBody(request),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
};
