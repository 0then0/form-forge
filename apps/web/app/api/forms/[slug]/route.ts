import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getPublishedForm } from "@/services/public-forms";

export const dynamic = "force-dynamic";

export const GET = async (
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) => {
  try {
    const { slug } = await context.params;
    const published = await getPublishedForm(slug);
    return NextResponse.json({
      data: {
        form: published.form,
        schema: published.version.schema,
        versionId: published.version.id,
        versionNumber: published.version.versionNumber,
      },
    });
  } catch (error) {
    return apiError(error);
  }
};
