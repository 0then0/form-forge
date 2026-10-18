import "server-only";

import { z } from "zod";
import { AppError } from "@/lib/errors";
import { submissionListQuerySchema } from "@/lib/submission-filters";
import { getFormForViewing, listActiveForms } from "./forms";
import { getSubmissionDetail, listSubmissions } from "./submissions";

const workspace = z.string().min(1).max(80);
const formInput = z
  .object({ workspaceSlug: workspace, formId: z.uuid() })
  .strict();
const submissionInput = z
  .object({ workspaceSlug: workspace, submissionId: z.uuid() })
  .strict();
const listInput = submissionListQuerySchema
  .safeExtend({ workspaceSlug: workspace })
  .strict();
const formsInput = z.object({ workspaceSlug: workspace }).strict();
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const tool = (name: string, description: string, schema: z.ZodType) => ({
  name,
  description,
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  annotations,
});

export const mcpTools = [
  tool(
    "list_forms",
    "List up to 100 active forms in a workspace. No submission values are returned.",
    formsInput,
  ),
  tool(
    "get_form",
    "Read an authorized form's draft and operational settings, including archived forms.",
    formInput,
  ),
  tool(
    "list_submissions",
    "Read one cursor page of authorized responses, with date, processing, delivery and answer-word filters. At most 100 records.",
    listInput,
  ),
  tool(
    "get_submission",
    "Read one authorized response, its original schema and bounded delivery history. Contains response values.",
    submissionInput,
  ),
];

export const callMcpTool = async (name: string, input: unknown) => {
  switch (name) {
    case "list_forms": {
      const { workspaceSlug } = formsInput.parse(input);
      const rows = await listActiveForms(workspaceSlug);
      return { data: rows.slice(0, 100), truncated: rows.length > 100 };
    }
    case "get_form": {
      const { workspaceSlug, formId } = formInput.parse(input);
      return getFormForViewing(workspaceSlug, formId);
    }
    case "list_submissions":
      return listSubmissions(listInput.parse(input));
    case "get_submission": {
      const { workspaceSlug, submissionId } = submissionInput.parse(input);
      return getSubmissionDetail(workspaceSlug, submissionId);
    }
    default:
      throw new AppError("BAD_REQUEST", "Unknown MCP tool", 400);
  }
};
