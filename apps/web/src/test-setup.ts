import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/form_forge_test_unavailable";
process.env.AUTH_SECRET ??= "test-auth-secret-at-least-32-characters";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";
process.env.AUTH_GITHUB_ID ??= "test-github-id";
process.env.AUTH_GITHUB_SECRET ??= "test-github-secret";
process.env.APP_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.INNGEST_EVENT_KEY ??= "test-inngest-event-key";
process.env.INNGEST_SIGNING_KEY ??= "test-inngest-signing-key";
process.env.WEBHOOK_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.FINGERPRINT_SECRET ??=
  "test-fingerprint-secret-at-least-32-characters";

afterEach(cleanup);
