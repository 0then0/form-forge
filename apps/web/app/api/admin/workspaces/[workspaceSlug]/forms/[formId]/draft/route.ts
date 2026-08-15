import { NextResponse } from "next/server";

import { apiError, MAX_FORM_SCHEMA_BODY_BYTES, parseJsonBody } from "@/lib/api";
import { saveDraft } from "@/services/forms";

type Context = {
  params: Promise<{ workspaceSlug: string; formId: string }>;
};

export const PUT = async (request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    const form = await saveDraft(
      workspaceSlug,
      formId,
      await parseJsonBody(request, MAX_FORM_SCHEMA_BODY_BYTES),
    );
    return NextResponse.json({ data: form });
  } catch (error) {
    return apiError(error);
  }
};
