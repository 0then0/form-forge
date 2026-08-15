// @vitest-environment node

import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("./url-policy", () => ({
  resolveWebhookTarget: vi.fn(async () => ({
    address: "203.0.113.20",
    family: 4,
    url: "https://hooks.example.com/webhook?source=form",
  })),
}));

import { postWebhook } from "./transport";

type FakeResponse = EventEmitter & { statusCode?: number };
type FakeRequest = EventEmitter & { end: () => void };

const mockRequest = (
  response: { body: Buffer; status: number } | "timeout",
  capture?: (options: RequestOptions) => void,
) => {
  mocks.request.mockImplementation((...arguments_: unknown[]) => {
    const options = arguments_.find(
      (value): value is RequestOptions =>
        typeof value === "object" && value !== null && "hostname" in value,
    );
    const callback = arguments_.find(
      (value): value is (response: IncomingMessage) => void =>
        typeof value === "function",
    );
    if (!options || !callback) {
      throw new Error(
        `Unexpected HTTPS request arguments: ${arguments_
          .map((value) => typeof value)
          .join(",")}`,
      );
    }
    capture?.(options);
    const outgoing = new EventEmitter() as FakeRequest;
    outgoing.end = () => {
      if (response === "timeout") return;
      const incoming = new EventEmitter() as FakeResponse;
      incoming.statusCode = response.status;
      callback(incoming as IncomingMessage);
      incoming.emit("data", response.body);
      incoming.emit("end");
    };
    options.signal?.addEventListener(
      "abort",
      () => outgoing.emit("error", options.signal?.reason),
      { once: true },
    );
    return outgoing as ClientRequest;
  });
};

describe("postWebhook", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("pins the resolved address while preserving TLS SNI and caps responses", async () => {
    let options: RequestOptions | undefined;
    mockRequest({ body: Buffer.alloc(70_000, "a"), status: 503 }, (value) => {
      options = value;
    });

    const result = await postWebhook(
      "https://hooks.example.com/webhook?source=form",
      "{}",
      { "X-Test": "value" },
    );

    expect(options).toMatchObject({
      hostname: "203.0.113.20",
      path: "/webhook?source=form",
      servername: "hooks.example.com",
    });
    expect(result.status).toBe(503);
    expect(Buffer.byteLength(result.responseExcerpt)).toBe(65_536);
  });

  it("aborts a request that does not complete before the timeout", async () => {
    mockRequest("timeout");

    await expect(
      postWebhook("https://hooks.example.com/webhook", "{}", {}, 5),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
