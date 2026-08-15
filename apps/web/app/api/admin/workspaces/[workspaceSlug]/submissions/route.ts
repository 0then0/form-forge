import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { listSubmissions } from "@/services/submissions";

const querySchema = z.object({
  cursor: z.string().optional(),
  deliveryStatus: z
    .enum(["pending", "processing", "succeeded", "failed"])
    .optional(),
  formId: z.uuid().optional(),
});

export const GET = async (
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) => {
  try {
    const { workspaceSlug } = await context.params;
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    return NextResponse.json({
      data: await listSubmissions({ workspaceSlug, ...query }),
    });
  } catch (error) {
    return apiError(error);
  }
};
