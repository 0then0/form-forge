import { submissionFieldIssuesSchema } from "@form-forge/form-schema";
import { z } from "zod";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export const submissionErrorDetailsSchema = z.object({
  fieldIssues: submissionFieldIssuesSchema
    .describe(
      "Stable validation codes and parameters, grouped by field key or _root.",
    )
    .optional(),
  closedIntake: z
    .object({
      customMessage: z.string().nullable(),
    })
    .describe(
      "Present when the form is closed. Null uses the default message in the submission's version language.",
    )
    .optional(),
});

export type SubmissionErrorDetails = z.infer<
  typeof submissionErrorDetailsSchema
>;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly retryAfterSeconds?: number,
    public readonly submissionDetails?: SubmissionErrorDetails,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundError = (message = "Resource not found") =>
  new AppError("NOT_FOUND", message, 404);

export const forbiddenError = () =>
  new AppError("FORBIDDEN", "You do not have permission for this action", 403);
