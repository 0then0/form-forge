import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppError } from "./errors";

type ErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    fieldErrors?: Record<string, string[]>;
  };
};

// These limits cover the domain maxima even when JSON uses six-byte Unicode
// escapes, while still bounding memory before parsing.
export const MAX_FORM_SCHEMA_BODY_BYTES = 16_000_000;
export const MAX_SUBMISSION_BODY_BYTES = 8_000_000;

const zodFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    fields[key] = [...(fields[key] ?? []), issue.message];
  }
  return fields;
};

export const apiError = (
  error: unknown,
  requestId = crypto.randomUUID(),
): NextResponse<ErrorBody> => {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid data",
          requestId,
          fieldErrors: zodFieldErrors(error),
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.fieldErrors === undefined
            ? {}
            : { fieldErrors: error.fieldErrors }),
        },
      },
      {
        ...(error.code === "RATE_LIMITED"
          ? { headers: { "Retry-After": "600" } }
          : {}),
        status: error.status,
      },
    );
  }

  Sentry.captureException(error, { tags: { requestId } });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId,
      },
    },
    { status: 500 },
  );
};

export const parseJsonBody = async (request: Request, maxBytes = 65_536) => {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AppError("BAD_REQUEST", "Request body is too large", 413);
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let raw = "";
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new AppError("BAD_REQUEST", "Request body is too large", 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON", 400);
  }
};
