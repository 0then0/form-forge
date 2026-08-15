// @vitest-environment node

import { beforeEach, expect, test, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ default: { lookup }, lookup }));

import { resolveWebhookTarget } from "./url-policy";

beforeEach(() => lookup.mockReset());

test("rejects a host if any DNS answer is private", async () => {
  lookup.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await expect(
    resolveWebhookTarget("https://hooks.example.com/path"),
  ).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
});

test("returns a public address for pinned transport lookup", async () => {
  lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  await expect(
    resolveWebhookTarget("https://hooks.example.com/path#fragment"),
  ).resolves.toEqual({
    address: "93.184.216.34",
    family: 4,
    url: "https://hooks.example.com/path",
  });
});

test.each([
  "http://example.com/hook",
  "https://localhost/hook",
  "https://127.0.0.1/hook",
  "https://[::1]/hook",
  "https://[::7f00:1]/hook",
  "https://[::ffff:7f00:1]/hook",
  "https://[fec0::1]/hook",
  "https://[2001:2::1]/hook",
  "https://[2001:20::1]/hook",
  "https://[3fff::1]/hook",
])("rejects unsafe webhook URL %s", async (url) => {
  await expect(resolveWebhookTarget(url)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
});

test("accepts a global-unicast IPv6 literal", async () => {
  await expect(
    resolveWebhookTarget("https://[2001:4860:4860::8888]/hook"),
  ).resolves.toMatchObject({
    address: "2001:4860:4860::8888",
    family: 6,
  });
});
