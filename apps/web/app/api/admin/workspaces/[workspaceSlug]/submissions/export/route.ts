import { apiError } from "@/lib/api";
import { exportSubmissionsCsv } from "@/services/submissions";

export const GET = async (
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) => {
  try {
    const { workspaceSlug } = await context.params;
    const csvStream = await exportSubmissionsCsv(workspaceSlug);
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
