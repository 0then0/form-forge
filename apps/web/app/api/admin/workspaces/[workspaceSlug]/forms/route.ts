import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody } from "@/lib/api";
import { createForm, listActiveForms } from "@/services/forms";

type Context = { params: Promise<{ workspaceSlug: string }> };

export const GET = async (_request: Request, context: Context) => {
  try {
    const { workspaceSlug } = await context.params;
    return NextResponse.json({ data: await listActiveForms(workspaceSlug) });
  } catch (error) {
    return apiError(error);
  }
};

export const POST = async (request: Request, context: Context) => {
  try {
    const { workspaceSlug } = await context.params;
    const input = z
      .object({ name: z.string().trim().min(1).max(160) })
      .strict()
      .parse(await parseJsonBody(request));
    const form = await createForm(workspaceSlug, input.name);
    return NextResponse.json({ data: form }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
};
