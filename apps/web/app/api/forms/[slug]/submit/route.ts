import { submissionRequestSchema } from "@form-forge/form-schema";
import { NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";

import { apiError, parseJsonBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { receiveSubmission } from "@/services/public-forms";
import { dispatchPendingOutbox } from "@/services/outbox";

const idempotencyKeySchema = z.string().min(1).max(200);

export const POST = async (
  request: Request,
  context: { params: Promise<{ slug: string }> },
) => {
  try {
    const { slug } = await context.params;
    const idempotencyHeader = request.headers.get("idempotency-key");
    if (!idempotencyHeader) {
      throw new AppError(
        "BAD_REQUEST",
        "Idempotency-Key header is required",
        400,
      );
    }
    const idempotencyKey = idempotencyKeySchema.parse(idempotencyHeader);
    const input = submissionRequestSchema.parse(await parseJsonBody(request));
    const forwardedFor = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    const userAgent = request.headers.get("user-agent") ?? undefined;
    const result = await receiveSubmission({
      ...(forwardedFor === undefined
        ? {}
        : { fallbackFingerprint: forwardedFor }),
      idempotencyKey,
      input,
      slug,
      ...(userAgent === undefined ? {} : { userAgent }),
    });
    try {
      await dispatchPendingOutbox(10);
    } catch (dispatchError) {
      Sentry.captureException(dispatchError, {
        tags: { operation: "submission-outbox-dispatch" },
      });
    }
    return NextResponse.json(
      {
        data: {
          duplicate: result.duplicate,
          status: "accepted",
          submissionId: result.id,
        },
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return apiError(error);
  }
};
