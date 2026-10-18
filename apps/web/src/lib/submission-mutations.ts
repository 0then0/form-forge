import { z } from "zod";

export const submissionStatusMutationSchema = z
  .object({ processingStatus: z.enum(["new", "processed"]) })
  .strict();
export const submissionDeletionSchema = z
  .object({ confirmation: z.uuid() })
  .strict();
