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
  forms,
  formVersions,
  outboxEvents,
  submissionEvents,
  submissions,
  webhookEndpoints,
} from "@/db/schema";
import { env } from "@/env";
import { AppError, notFoundError } from "@/lib/errors";

const hashFingerprint = (value: string): string =>
  createHmac("sha256", env.FINGERPRINT_SECRET).update(value).digest("hex");

export const getPublishedForm = async (slug: string, versionId?: string) => {
  const [form] = await db
    .select({
      id: forms.id,
      name: forms.name,
      publishedVersionId: forms.publishedVersionId,
      slug: forms.slug,
      status: forms.status,
    })
    .from(forms)
    .where(eq(forms.slug, slug))
    .limit(1);
  if (!form || form.status !== "published" || !form.publishedVersionId) {
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
    form: { id: form.id, name: form.name, slug: form.slug },
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

  const [previous] = await db
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
  if (previous) {
    if (
      previous.formVersionId !== published.version.id ||
      !isDeepStrictEqual(previous.receivedValues, normalized.receivedValues)
    ) {
      throw new AppError(
        "CONFLICT",
        "This idempotency key was already used for a different submission",
        409,
      );
    }
    return { id: previous.id, duplicate: true };
  }

  const utm = Object.fromEntries(
    Object.entries(parsedInput.context?.utm ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  return db.transaction(async (tx) => {
    const [activeForm] = await tx
      .select({
        status: forms.status,
      })
      .from(forms)
      .where(eq(forms.id, published.form.id))
      .limit(1)
      .for("update");
    if (!activeForm || activeForm.status !== "published") {
      throw notFoundError("Published form not found");
    }

    if (fingerprintHash) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${published.form.id}:${fingerprintHash}`}, 0))`,
      );
    }

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

    await enforceSubmissionRate(tx, published.form.id, fingerprintHash);

    const [created] = await tx
      .insert(submissions)
      .values({
        deliveryStatus: "pending",
        fingerprintHash,
        formId: published.form.id,
        formVersionId: published.version.id,
        idempotencyKey,
        normalizedValues: normalized.normalizedValues,
        receivedValues: normalized.receivedValues,
        referrer: parsedInput.context?.referrer?.slice(0, 2_000),
        userAgent: userAgent?.slice(0, 1_000),
        utm,
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

    await tx.insert(submissionEvents).values({
      data: { formVersionId: published.version.id },
      submissionId: created.id,
      type: "submission.received",
    });
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
