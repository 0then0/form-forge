import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import { publishForm } from "@/services/forms";

type Context = {
  params: Promise<{ workspaceSlug: string; formId: string }>;
};

export const POST = async (request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    const version = await publishForm(
      workspaceSlug,
      formId,
      await parseJsonBody(request),
    );
    return NextResponse.json({ data: version }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
};
