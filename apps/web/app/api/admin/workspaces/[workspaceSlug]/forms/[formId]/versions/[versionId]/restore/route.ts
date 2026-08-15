import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { restoreDraftFromVersion } from "@/services/forms";

type Context = {
  params: Promise<{
    workspaceSlug: string;
    formId: string;
    versionId: string;
  }>;
};

export const POST = async (_request: Request, context: Context) => {
  try {
    const { formId, versionId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await restoreDraftFromVersion(workspaceSlug, formId, versionId),
    });
  } catch (error) {
    return apiError(error);
  }
};
