import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { listFormVersions } from "@/services/forms";

type Context = {
  params: Promise<{ workspaceSlug: string; formId: string }>;
};

export const GET = async (_request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await listFormVersions(workspaceSlug, formId),
    });
  } catch (error) {
    return apiError(error);
  }
};
