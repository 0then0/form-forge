import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requestManualRetry } from "@/services/deliveries";

export const POST = async (
  _request: Request,
  context: { params: Promise<{ deliveryId: string; workspaceSlug: string }> },
) => {
  try {
    const { deliveryId, workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await requestManualRetry(workspaceSlug, deliveryId),
    });
  } catch (error) {
    return apiError(error);
  }
};
