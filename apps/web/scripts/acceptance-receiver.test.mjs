// @vitest-environment node
import { afterAll, beforeAll, expect, test } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:https";
import { createAcceptanceReceiver } from "./acceptance-receiver.mjs";

const directory = mkdtempSync(join(tmpdir(), "ff-receiver-"));
const secret = "disposable-test-secret";
let receiver;
let port;
let ca;
beforeAll(async () => {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      join(directory, "key"),
      "-out",
      join(directory, "cert"),
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  ca = readFileSync(join(directory, "cert"));
  receiver = createAcceptanceReceiver({
    secret,
    evidencePath: join(directory, "evidence"),
    key: readFileSync(join(directory, "key")),
    cert: ca,
  });
  await new Promise((resolve) =>
    receiver.server.listen(0, "127.0.0.1", resolve),
  );
  port = receiver.server.address().port;
});
afterAll(async () => {
  receiver.shutdown();
  await new Promise((resolve) => receiver.server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
});
function send(
  body,
  {
    id = randomUUID(),
    path = "/success",
    timestamp = String(Math.floor(Date.now() / 1000)),
    signed = true,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const req = request(
      {
        hostname: "127.0.0.1",
        servername: "localhost",
        port,
        ca,
        method: "POST",
        path,
        headers: {
          "x-form-forge-id": id,
          "x-form-forge-timestamp": timestamp,
          ...(signed ? { "x-form-forge-signature": `v1=${signature}` } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
test("malformed and unauthenticated input does not crash or consume retry state", async () => {
  const id = randomUUID();
  for (const body of [
    "null",
    "[]",
    "42",
    "{",
    JSON.stringify({ id, type: "wrong" }),
  ])
    expect(await send(body, { id })).toBe(401);
  const body = JSON.stringify({ id, type: "submission.created" });
  expect(await send(body, { id, path: "/retry", signed: false })).toBe(401);
  expect(await send(body, { id, timestamp: "1" })).toBe(401);
  expect(await send(body, { id, path: "/retry" })).toBe(503);
  expect(await send(body, { id, path: "/retry" })).toBe(200);
  const records = readFileSync(join(directory, "evidence"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  expect(records.map((r) => r.ordinal)).toEqual([1, 2]);
  expect(
    records.every((r) => r.signatureValid && r.timestampValid && r.idValid),
  ).toBe(true);
});
test("evidence write failure returns 500 and permits a later valid request", async () => {
  const broken = createAcceptanceReceiver({
    secret,
    evidencePath: join(directory, "missing", "evidence"),
    key: readFileSync(join(directory, "key")),
    cert: ca,
  });
  const previous = port;
  await new Promise((resolve) => broken.server.listen(0, "127.0.0.1", resolve));
  port = broken.server.address().port;
  const id = randomUUID();
  expect(
    await send(JSON.stringify({ id, type: "submission.created" }), { id }),
  ).toBe(500);
  port = previous;
  broken.shutdown();
  const nextId = randomUUID();
  expect(
    await send(JSON.stringify({ id: nextId, type: "submission.created" }), {
      id: nextId,
    }),
  ).toBe(200);
});

test("an aborted request body does not terminate the receiver", async () => {
  let observed;
  const seen = new Promise((resolve) =>
    receiver.server.once("request", (incoming) => {
      observed = incoming;
      resolve();
    }),
  );
  const req = request({
    hostname: "127.0.0.1",
    servername: "localhost",
    port,
    ca,
    method: "POST",
    headers: { "content-length": "100" },
  });
  req.on("error", () => {});
  req.write("{");
  await seen;
  const aborted = new Promise((resolve) => observed.once("aborted", resolve));
  req.destroy();
  await aborted;
  const id = randomUUID();
  expect(
    await send(JSON.stringify({ id, type: "submission.created" }), { id }),
  ).toBe(200);
});
