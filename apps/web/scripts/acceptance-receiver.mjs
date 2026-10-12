import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { createServer as controlServer } from "node:http";
import { pathToFileURL } from "node:url";

export function createAcceptanceReceiver({ secret, evidencePath, key, cert }) {
  if (!secret) throw new Error("RECEIVER_SECRET required");
  const evidence = [];
  const counts = new Map();
  const held = new Set();
  const server = createServer(
    {
      key,
      cert,
    },
    async (request, response) => {
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 8_000_000) {
            response.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const timestamp = String(
          request.headers["x-form-forge-timestamp"] ?? "",
        );
        const id = String(request.headers["x-form-forge-id"] ?? "");
        const signature = String(
          request.headers["x-form-forge-signature"] ?? "",
        );
        const expected = createHmac("sha256", secret)
          .update(`${timestamp}.`)
          .update(body)
          .digest();
        const supplied = /^v1=[0-9a-f]{64}$/.test(signature)
          ? Buffer.from(signature.slice(3), "hex")
          : Buffer.alloc(0);
        const signatureValid =
          expected.length === supplied.length &&
          timingSafeEqual(expected, supplied);
        const timestampValid =
          /^\d+$/.test(timestamp) &&
          Math.abs(Date.now() / 1_000 - Number(timestamp)) <= 300;
        let envelope;
        try {
          envelope = JSON.parse(body.toString("utf8"));
        } catch {
          envelope = {};
        }
        const idValid =
          /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id) &&
          envelope !== null &&
          typeof envelope === "object" &&
          !Array.isArray(envelope) &&
          envelope.id === id &&
          envelope.type === "submission.created";
        const valid = signatureValid && timestampValid && idValid;
        if (!valid) {
          response.writeHead(401).end("invalid request");
          return;
        }
        const ordinal = (counts.get(id) ?? 0) + 1;
        const hold = request.url === "/hold" && ordinal === 1 && valid;
        const status = !valid
          ? 401
          : request.url === "/retry" && ordinal === 1
            ? 503
            : 200;
        const record = {
          receivedAt: new Date().toISOString(),
          timestamp: Number(timestamp),
          deliveryId: id,
          ordinal,
          path: request.url,
          bodySha256: createHash("sha256").update(body).digest("hex"),
          bytes: body.length,
          signatureValid,
          timestampValid,
          idValid,
          response: hold ? "withheld" : status,
        };
        // Only verification metadata; never retain body, signature or endpoint secret.
        appendFileSync(evidencePath, `${JSON.stringify(record)}\n`, {
          mode: 0o600,
        });
        counts.set(id, ordinal);
        evidence.push(record);
        if (hold) {
          held.add(response);
          response.on("close", () => held.delete(response));
          return;
        }
        response.writeHead(status).end(status === 200 ? "accepted" : "retry");
      } catch {
        // Aborted input and evidence I/O failures must not terminate the receiver.
        if (!response.destroyed && !response.headersSent)
          response.writeHead(500).end("receiver error");
        else response.destroy();
      }
    },
  );

  // Control surface is reachable only inside the isolated Docker fixture network.
  const control = controlServer((request, response) => {
    if (request.url !== "/evidence") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(evidence));
  });

  const shutdown = () => {
    for (const response of held) response.destroy();
    server.close();
    control.close();
  };
  return { server, control, shutdown };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const receiver = createAcceptanceReceiver({
    secret: process.env.RECEIVER_SECRET,
    evidencePath: "/evidence/receiver.jsonl",
    key: readFileSync("/tls/privkey.pem"),
    cert: readFileSync("/tls/fullchain.pem"),
  });
  receiver.server.listen(443, "0.0.0.0");
  receiver.control.listen(8889, "0.0.0.0");
  process.on("SIGTERM", receiver.shutdown);
  process.on("SIGINT", receiver.shutdown);
}
