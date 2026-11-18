import { MAX_FORM_TEMPLATE_BYTES } from "@form-forge/form-schema";
import { NextResponse } from "next/server";

import { requireWorkspace } from "@/auth/permissions";
import { apiError, readTextBody } from "@/lib/api";
import { previewFormTemplate } from "@/services/form-templates";

type Context = { params: Promise<{ workspaceSlug: string }> };

export const POST = async (request: Request, context: Context) => {
  try {
    const { workspaceSlug } = await context.params;
    // Check access before buffering a template body.
    await requireWorkspace(workspaceSlug, "editor");
    const raw = await readTextBody(request, MAX_FORM_TEMPLATE_BYTES);
    return NextResponse.json({
      data: await previewFormTemplate(workspaceSlug, raw),
    });
  } catch (error) {
    return apiError(error);
  }
};
