import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@/env";

const getKey = (): Buffer => {
  const key = Buffer.from(env.WEBHOOK_ENCRYPTION_KEY, "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      "WEBHOOK_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  return key;
};

export const generateWebhookSecret = (): string =>
  randomBytes(32).toString("base64url");

export const encryptWebhookSecret = (secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
};

export const decryptWebhookSecret = (value: string): string => {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported webhook secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
