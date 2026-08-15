import { NextResponse } from "next/server";

import { apiError, MAX_FORM_SCHEMA_BODY_BYTES, parseJsonBody } from "@/lib/api";
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
      await parseJsonBody(request, MAX_FORM_SCHEMA_BODY_BYTES),
    );
    return NextResponse.json({ data: version }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
};
