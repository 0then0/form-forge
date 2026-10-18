import { z } from "zod";

export const submissionFilterSchema = z
  .object({
    deliveryStatus: z
      .enum(["pending", "processing", "succeeded", "failed"])
      .optional(),
    processingStatus: z.enum(["new", "processed"]).optional(),
    formId: z.uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
    q: z.string().trim().min(2).max(100).optional(),
  })
  .refine(
    (value) =>
      !value.from ||
      !value.until ||
      new Date(value.from) < new Date(value.until),
    {
      message: "The start must be before the end of the date range",
      path: ["until"],
    },
  );

export const submissionListQuerySchema = submissionFilterSchema.safeExtend({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type SubmissionFilters = z.infer<typeof submissionFilterSchema>;
