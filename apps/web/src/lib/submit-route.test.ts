// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { AppError } from "./errors";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  receive: vi.fn(),
  dispatch: vi.fn(),
  after: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/services/usage", () => ({ limitSubmitRequest: mocks.limit }));
vi.mock("@/services/public-forms", () => ({
  receiveSubmission: mocks.receive,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/services/outbox", () => ({
  dispatchSubmissionOutbox: mocks.dispatch,
}));
import { POST } from "../../app/api/forms/[slug]/submit/route";

beforeEach(() => {
  mocks.limit.mockReset();
  mocks.receive.mockReset();
});

test("rejects an exhausted request budget before reading the body or persisting data", async () => {
  mocks.limit.mockRejectedValue(
    new AppError("RATE_LIMITED", "Limit", 429, undefined, 42),
  );
  const request = new Request("http://localhost/api/forms/test/submit", {
    method: "POST",
    body: "invalid JSON",
  });
  const response = await POST(request, {
    params: Promise.resolve({ slug: "test" }),
  });
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("42");
  expect(request.bodyUsed).toBe(false);
  expect(mocks.receive).not.toHaveBeenCalled();
});

test("charges malformed requests even when idempotency headers are absent", async () => {
  const response = await POST(
    new Request("http://localhost/api/forms/test/submit", {
      method: "POST",
      body: "invalid JSON",
    }),
    { params: Promise.resolve({ slug: "test" }) },
  );
  expect(response.status).toBe(400);
  expect(mocks.limit).toHaveBeenCalledOnce();
  expect(mocks.receive).not.toHaveBeenCalled();
});

test("a committed submission stays accepted when the after lifecycle is unavailable", async () => {
  mocks.receive.mockResolvedValue({ id: "saved", duplicate: false });
  mocks.after.mockImplementation(() => {
    throw new Error("No waitUntil");
  });
  const response = await POST(
    new Request("http://localhost/api/forms/test/submit", {
      method: "POST",
      headers: { "Idempotency-Key": "test" },
      body: JSON.stringify({
        versionId: "11111111-1111-4111-8111-111111111111",
        values: {},
      }),
    }),
    { params: Promise.resolve({ slug: "test" }) },
  );
  expect(response.status).toBe(201);
  expect((await response.json()).data.submissionId).toBe("saved");
});
