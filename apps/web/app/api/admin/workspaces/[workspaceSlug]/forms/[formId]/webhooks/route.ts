import { NextResponse } from "next/server";

import { apiError, parseJsonBody } from "@/lib/api";
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
} from "@/services/webhook-endpoints";

type Context = {
  params: Promise<{ workspaceSlug: string; formId: string }>;
};

export const GET = async (_request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await listWebhookEndpoints(workspaceSlug, formId),
    });
  } catch (error) {
    return apiError(error);
  }
};

export const POST = async (request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    const endpoint = await createWebhookEndpoint(
      workspaceSlug,
      formId,
      await parseJsonBody(request),
    );
    return NextResponse.json({ data: endpoint }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
};
