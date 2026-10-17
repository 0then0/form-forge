import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError, parseJsonBody } from "@/lib/api";
import { permanentlyDeleteForm } from "@/services/forms";

export const DELETE = async (
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; formId: string }> },
) => {
  try {
    const { workspaceSlug, formId } = await context.params;
    const { confirmation } = z
      .object({ confirmation: z.string().min(1).max(160) })
      .strict()
      .parse(await parseJsonBody(request));
    return NextResponse.json({
      data: await permanentlyDeleteForm(workspaceSlug, formId, confirmation),
    });
  } catch (error) {
    return apiError(error);
  }
};
