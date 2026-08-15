import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { rotateWebhookEndpointSecret } from "@/services/webhook-endpoints";

export const POST = async (
  _request: Request,
  context: {
    params: Promise<{
      endpointId: string;
      formId: string;
      workspaceSlug: string;
    }>;
  },
) => {
  try {
    const { endpointId, formId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await rotateWebhookEndpointSecret(
        workspaceSlug,
        formId,
        endpointId,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
};
