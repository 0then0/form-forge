import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import {
  archiveWebhookEndpoint,
  updateWebhookEndpoint,
} from "@/services/webhook-endpoints";

type Context = {
  params: Promise<{
    endpointId: string;
    formId: string;
    workspaceSlug: string;
  }>;
};

export const PATCH = async (request: Request, context: Context) => {
  try {
    const { endpointId, formId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await updateWebhookEndpoint(
        workspaceSlug,
        formId,
        endpointId,
        await parseJsonBody(request),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
};

export const DELETE = async (_request: Request, context: Context) => {
  try {
    const { endpointId, formId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await archiveWebhookEndpoint(workspaceSlug, formId, endpointId),
    });
  } catch (error) {
    return apiError(error);
  }
};
