import { z } from "zod";
import { NextResponse } from "next/server";

import { apiError, MAX_FORM_SCHEMA_BODY_BYTES, parseJsonBody } from "@/lib/api";
import { publishForm, publishSavedDraft } from "@/services/forms";

type Context = {
  params: Promise<{ workspaceSlug: string; formId: string }>;
};

export const POST = async (request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    const input = await parseJsonBody(request, MAX_FORM_SCHEMA_BODY_BYTES);
    const savedDraft = z
      .object({ expectedRevision: z.iso.datetime() })
      .strict()
      .safeParse(input);
    const version = savedDraft.success
      ? await publishSavedDraft(
          workspaceSlug,
          formId,
          savedDraft.data.expectedRevision,
        )
      : await publishForm(workspaceSlug, formId, input);
    return NextResponse.json({ data: version }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
};
