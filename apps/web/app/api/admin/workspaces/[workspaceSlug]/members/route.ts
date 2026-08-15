import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody } from "@/lib/api";
import {
  addMember,
  listMembers,
  removeMember,
  updateMember,
} from "@/services/memberships";

type Context = { params: Promise<{ workspaceSlug: string }> };

export const GET = async (_request: Request, context: Context) => {
  try {
    const { workspaceSlug } = await context.params;
    return NextResponse.json({ data: await listMembers(workspaceSlug) });
  } catch (error) {
    return apiError(error);
  }
};

export const POST = async (request: Request, context: Context) => {
  try {
    const { workspaceSlug } = await context.params;
    return NextResponse.json(
      { data: await addMember(workspaceSlug, await parseJsonBody(request)) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
};

export const PATCH = async (request: Request, context: Context) => {
  try {
    const { workspaceSlug } = await context.params;
    return NextResponse.json({
      data: await updateMember(workspaceSlug, await parseJsonBody(request)),
    });
  } catch (error) {
    return apiError(error);
  }
};

export const DELETE = async (request: Request, context: Context) => {
  try {
    const { workspaceSlug } = await context.params;
    const userId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("userId"));
    return NextResponse.json({
      data: await removeMember(workspaceSlug, userId),
    });
  } catch (error) {
    return apiError(error);
  }
};
