import { z } from "zod";
import { MAX_SUBMISSIONS_PAGE_SIZE } from "./submission-filters";

export const submissionStatusMutationSchema = z
  .object({ processingStatus: z.enum(["new", "processed"]) })
  .strict();
export const submissionDeletionSchema = z
  .object({ confirmation: z.uuid() })
  .strict();

export const markSubmissionsProcessedSchema = z
  .object({
    formId: z.uuid(),
    submissionIds: z
      .array(z.uuid())
      .min(1)
      .max(MAX_SUBMISSIONS_PAGE_SIZE)
      .refine(
        (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
        "Submission IDs must be unique",
      )
      .meta({ uniqueItems: true }),
  })
  .strict();
