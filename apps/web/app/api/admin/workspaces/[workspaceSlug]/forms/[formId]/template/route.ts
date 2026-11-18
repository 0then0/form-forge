import { apiError } from "@/lib/api";
import { exportFormTemplate } from "@/services/form-templates";

type Context = {
  params: Promise<{ workspaceSlug: string; formId: string }>;
};

export const GET = async (request: Request, context: Context) => {
  try {
    const { formId, workspaceSlug } = await context.params;
    const { body, fileName } = await exportFormTemplate(
      workspaceSlug,
      formId,
      new URL(request.url).searchParams.get("revision"),
    );
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return apiError(error);
  }
};
