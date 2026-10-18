import "server-only";

import { createHmac } from "node:crypto";
import { env } from "@/env";

export const hashDeletedSubmissionKey = (formId: string, key: string) =>
  createHmac("sha256", env.FINGERPRINT_SECRET)
    .update(JSON.stringify(["deleted-submission", formId, key]))
    .digest("hex");
