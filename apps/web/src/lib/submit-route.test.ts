// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { AppError } from "./errors";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), receive: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/services/usage", () => ({ limitSubmitRequest: mocks.limit }));
vi.mock("@/services/public-forms", () => ({
  receiveSubmission: mocks.receive,
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
