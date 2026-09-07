import { submissionRequestSchema } from "@form-forge/form-schema";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, MAX_SUBMISSION_BODY_BYTES, parseJsonBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { trustedForwardedFor } from "@/lib/request-fingerprint";
import { env } from "@/env";
import { receiveSubmission } from "@/services/public-forms";

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
    const input = submissionRequestSchema.parse(
      await parseJsonBody(request, MAX_SUBMISSION_BODY_BYTES),
    );
    const forwardedFor = trustedForwardedFor(
      request.headers,
      env.TRUST_PROXY === "1",
    );
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
