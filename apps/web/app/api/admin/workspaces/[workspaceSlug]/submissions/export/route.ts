import { apiError } from "@/lib/api";
import { exportSubmissionsCsv } from "@/services/submissions";
import { z } from "zod";

const querySchema = z.object({
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
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const csvStream = await exportSubmissionsCsv(workspaceSlug, query);
    return new Response(csvStream, {
      headers: {
        "Content-Disposition": `attachment; filename="form-forge-submissions-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    return apiError(error);
  }
};
