import { z } from "zod";

const formPolicySchema = z
  .object({
    collectMetadata: z.boolean(),
    paused: z.boolean(),
    closesAt: z.iso.datetime({ offset: true }).nullable(),
    maxAccepted: z.number().int().min(1).max(2_147_483_647).nullable(),
    closedMessage: z.string().trim().min(1).max(500),
  })
  .strict();

export type FormPolicy = z.infer<typeof formPolicySchema>;

export const isIntakeClosed = (
  policy: {
    paused: boolean;
    closesAt: Date | null;
    maxAccepted: number | null;
    acceptedCount: number;
  },
  now = new Date(),
) =>
  policy.paused ||
  (policy.closesAt !== null && policy.closesAt <= now) ||
  (policy.maxAccepted !== null && policy.acceptedCount >= policy.maxAccepted);

export const formPolicyMutationSchema = z
  .object({
    expectedRevision: z.iso.datetime(),
    policy: formPolicySchema,
  })
  .strict();
