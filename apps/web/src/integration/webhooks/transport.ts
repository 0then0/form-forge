import "server-only";

import { request } from "node:https";

import { resolveWebhookTarget } from "./url-policy";

const MAX_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = 10_000;

const withAbortSignal = async <T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) throw signal.reason;
  let rejectOnAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(signal.reason);
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (rejectOnAbort) signal.removeEventListener("abort", rejectOnAbort);
  }
};

export type WebhookResponse = {
  ok: boolean;
  responseExcerpt: string;
  status: number;
};

export const postWebhook = async (
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<WebhookResponse> => {
  const signal = AbortSignal.timeout(timeoutMs);
  const target = await withAbortSignal(resolveWebhookTarget(rawUrl), signal);
  const url = new URL(target.url);

  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        headers: { ...headers, Host: url.host },
        hostname: target.address,
        method: "POST",
        path: `${url.pathname}${url.search}`,
        port: url.port ? Number(url.port) : 443,
        protocol: "https:",
        servername: url.hostname.replace(/^\[|\]$/g, ""),
        signal,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on("data", (value: Buffer | string) => {
          if (size >= MAX_RESPONSE_BYTES) return;
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          const remaining = MAX_RESPONSE_BYTES - size;
          chunks.push(chunk.subarray(0, remaining));
          size += Math.min(chunk.byteLength, remaining);
        });
        incoming.on("end", () => {
          const status = incoming.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            responseExcerpt: Buffer.concat(chunks).toString("utf8"),
            status,
          });
        });
        incoming.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
};
