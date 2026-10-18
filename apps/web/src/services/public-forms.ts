import "server-only";

import {
  formSchemaV1Schema,
  normalizeSubmission,
  submissionRequestSchema,
  type SubmissionRequest,
} from "@form-forge/form-schema";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { db } from "@/db/client";
import {
  deletedSubmissionKeys,
  forms,
  formVersions,
  outboxEvents,
  submissionEvents,
  submissions,
  webhookEndpoints,
} from "@/db/schema";
import { env } from "@/env";
import { AppError, notFoundError } from "@/lib/errors";
import {
  MAX_DAILY_SUBMISSIONS,
  MAX_DAILY_DELIVERIES,
} from "@/lib/usage-policy";
import { consumeUsage, consumeSubmissionRate } from "./usage";
import { isIntakeClosed } from "@/lib/form-policy";
import { hashDeletedSubmissionKey } from "@/lib/deleted-submission-key";

const hashFingerprint = (value: string): string =>
  createHmac("sha256", env.FINGERPRINT_SECRET).update(value).digest("hex");

export const getPublishedForm = async (slug: string, versionId?: string) => {
  const [form] = await db
    .select({
      paused: forms.paused,
      closesAt: forms.closesAt,
      maxAccepted: forms.maxAccepted,
      acceptedCount: forms.acceptedCount,
      closedMessage: forms.closedMessage,
      collectMetadata: forms.collectMetadata,
      id: forms.id,
      name: forms.name,
      publishedVersionId: forms.publishedVersionId,
      slug: forms.slug,
      status: forms.status,
    })
    .from(forms)
    .where(eq(forms.slug, slug))
    .limit(1);
  if (form?.status !== "published" || !form.publishedVersionId) {
    throw notFoundError("Published form not found");
  }

  const requestedVersionId = versionId ?? form.publishedVersionId;
  const [version] = await db
    .select({
      id: formVersions.id,
      publishedAt: formVersions.publishedAt,
      schema: formVersions.schema,
      versionNumber: formVersions.versionNumber,
    })
    .from(formVersions)
    .where(
      and(
        eq(formVersions.id, requestedVersionId),
        eq(formVersions.formId, form.id),
      ),
    )
    .limit(1);
  if (!version) throw notFoundError("Published form version not found");

  return {
    form: {
      id: form.id,
      name: form.name,
      slug: form.slug,
      collectMetadata: form.collectMetadata,
    },
    intake: {
      closed: isIntakeClosed(form),
      closesAt: form.closesAt?.toISOString() ?? null,
      message: form.closedMessage,
    },
    version: { ...version, schema: formSchemaV1Schema.parse(version.schema) },
  };
};

const enforceSubmissionRate = async (
  executor: Pick<typeof db, "select">,
  formId: string,
  fingerprintHash: string | null,
) => {
  if (!fingerprintHash) return;
  const since = new Date(Date.now() - 10 * 60 * 1_000);
  const [result] = await executor
    .select({ value: count() })
    .from(submissions)
    .where(
      and(
        eq(submissions.formId, formId),
        eq(submissions.fingerprintHash, fingerprintHash),
        gt(submissions.createdAt, since),
      ),
    );
  if ((result?.value ?? 0) >= 20) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many submissions. Please try again later.",
      429,
    );
  }
};

export const receiveSubmission = async ({
  fallbackFingerprint,
  idempotencyKey,
  input,
  slug,
  userAgent,
}: {
  fallbackFingerprint?: string;
  idempotencyKey: string;
  input: SubmissionRequest;
  slug: string;
  userAgent?: string;
}) => {
  const parsedInput = submissionRequestSchema.parse(input);
  const published = await getPublishedForm(slug, parsedInput.versionId);
  const normalized = normalizeSubmission(
    published.version.schema,
    parsedInput.values,
  );
  if (!normalized.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "One or more fields are invalid",
      422,
      Object.fromEntries(
        normalized.errors.map((error) => [error.field, [error.message]]),
      ),
    );
  }

  // Prefer the proxy-provided address. visitorId is only a fallback because it
  // is controlled by the public client and can be rotated by a caller.
  const fingerprintSource =
    fallbackFingerprint ?? parsedInput.context?.visitorId;
  const fingerprintHash = fingerprintSource
    ? hashFingerprint(fingerprintSource)
    : null;

  const utm = Object.fromEntries(
    Object.entries(parsedInput.context?.utm ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  return db.transaction(async (tx) => {
    const [activeForm] = await tx
      .select()
      .from(forms)
      .where(eq(forms.id, published.form.id))
      .limit(1)
      .for("update");
    if (activeForm?.status !== "published") {
      throw notFoundError("Published form not found");
    }

    const [deleted] = await tx
      .select({ keyHash: deletedSubmissionKeys.keyHash })
      .from(deletedSubmissionKeys)
      .where(
        and(
          eq(deletedSubmissionKeys.formId, published.form.id),
          eq(
            deletedSubmissionKeys.keyHash,
            hashDeletedSubmissionKey(published.form.id, idempotencyKey),
          ),
          gt(deletedSubmissionKeys.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (deleted)
      throw new AppError(
        "CONFLICT",
        "This submission was deleted. Its idempotency key cannot be reused for 30 days.",
        409,
      );

    const [existingSubmission] = await tx
      .select({
        formVersionId: submissions.formVersionId,
        id: submissions.id,
        receivedValues: submissions.receivedValues,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.formId, published.form.id),
          eq(submissions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existingSubmission) {
      if (
        existingSubmission.formVersionId !== published.version.id ||
        !isDeepStrictEqual(
          existingSubmission.receivedValues,
          normalized.receivedValues,
        )
      ) {
        throw new AppError(
          "CONFLICT",
          "This idempotency key was already used for a different submission",
          409,
        );
      }
      return { id: existingSubmission.id, duplicate: true };
    }

    // The form row lock serializes admission with policy changes and deletion.
    // Idempotent successes above remain successful even when intake has closed.
    const clock = await tx.execute<{ epochMs: string }>(
      sql`select extract(epoch from clock_timestamp()) * 1000 as "epochMs"`,
    );
    if (
      isIntakeClosed(
        activeForm,
        new Date(Number(clock.rows[0]?.epochMs ?? Date.now())),
      )
    ) {
      throw new AppError("CONFLICT", activeForm.closedMessage, 409);
    }

    if (activeForm.collectMetadata) {
      await enforceSubmissionRate(tx, published.form.id, fingerprintHash);
    }
    if (fingerprintSource)
      await consumeSubmissionRate(tx, published.form.id, fingerprintSource);

    const endpointIds = await tx
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.formId, published.form.id),
          eq(webhookEndpoints.enabled, true),
          isNull(webhookEndpoints.archivedAt),
        ),
      );
    await consumeUsage(
      tx,
      `submissions:${activeForm.workspaceId}`,
      MAX_DAILY_SUBMISSIONS,
      86_400,
    );
    await consumeUsage(
      tx,
      `deliveries:${activeForm.workspaceId}`,
      MAX_DAILY_DELIVERIES,
      86_400,
      endpointIds.length,
    );

    const [created] = await tx
      .insert(submissions)
      .values({
        deliveryStatus: "pending",
        fingerprintHash: activeForm.collectMetadata ? fingerprintHash : null,
        formId: published.form.id,
        formVersionId: published.version.id,
        idempotencyKey,
        normalizedValues: normalized.normalizedValues,
        receivedValues: normalized.receivedValues,
        referrer: activeForm.collectMetadata
          ? parsedInput.context?.referrer?.slice(0, 2_000)
          : null,
        userAgent: activeForm.collectMetadata
          ? userAgent?.slice(0, 1_000)
          : null,
        utm: activeForm.collectMetadata ? utm : {},
      })
      .onConflictDoNothing({
        target: [submissions.formId, submissions.idempotencyKey],
      })
      .returning({ id: submissions.id });

    if (!created) {
      const [existing] = await tx
        .select({
          formVersionId: submissions.formVersionId,
          id: submissions.id,
          receivedValues: submissions.receivedValues,
        })
        .from(submissions)
        .where(
          and(
            eq(submissions.formId, published.form.id),
            eq(submissions.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (!existing)
        throw new Error("Idempotent submission could not be found");
      if (
        existing.formVersionId !== published.version.id ||
        !isDeepStrictEqual(existing.receivedValues, normalized.receivedValues)
      ) {
        throw new AppError(
          "CONFLICT",
          "This idempotency key was already used for a different submission",
          409,
        );
      }
      return { id: existing.id, duplicate: true };
    }

    await tx
      .update(forms)
      .set({ acceptedCount: sql`${forms.acceptedCount} + 1` })
      .where(eq(forms.id, published.form.id));
    await tx.insert(submissionEvents).values({
      data: { formVersionId: published.version.id },
      submissionId: created.id,
      type: "submission.received",
    });
    await tx.insert(outboxEvents).values({
      aggregateId: created.id,
      payload: {
        endpointIds: endpointIds.map((endpoint) => endpoint.id),
        submissionId: created.id,
      },
      type: "submission.received",
    });

    return { id: created.id, duplicate: false };
  });
};
