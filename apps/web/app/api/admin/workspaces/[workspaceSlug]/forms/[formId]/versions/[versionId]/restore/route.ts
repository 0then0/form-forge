import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import { z } from "zod";
import { restoreDraftFromVersion } from "@/services/forms";

type Context = {
  params: Promise<{
    workspaceSlug: string;
    formId: string;
    versionId: string;
  }>;
};

export const POST = async (request: Request, context: Context) => {
  try {
    const { formId, versionId, workspaceSlug } = await context.params;
    const { expectedRevision } = z
      .object({ expectedRevision: z.iso.datetime() })
      .strict()
      .parse(await parseJsonBody(request));
    return NextResponse.json({
      data: await restoreDraftFromVersion(
        workspaceSlug,
        formId,
        versionId,
        expectedRevision,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
};
