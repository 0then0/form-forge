import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { AppError } from "@/lib/errors";

const isPrivateIpv4 = (address: string): boolean => {
  const parts = address.split(".").map(Number);
  const first = parts[0];
  const second = parts[1];
  if (first === undefined || second === undefined) return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
};

const isPrivateIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
};

const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
};

export const validateWebhookUrl = async (rawUrl: string): Promise<string> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Webhook URL is invalid", 422);
  }
  if (url.protocol !== "https:") {
    throw new AppError("VALIDATION_ERROR", "Webhook URL must use HTTPS", 422);
  }
  if (url.username || url.password) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Webhook URL cannot contain credentials",
      422,
    );
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Private webhook hosts are not allowed",
      422,
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  if (literalFamily && isPrivateAddress(hostname)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Private webhook hosts are not allowed",
      422,
    );
  }
  if (!literalFamily) {
    let addresses;
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      throw new AppError(
        "VALIDATION_ERROR",
        "Webhook host could not be resolved",
        422,
      );
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isPrivateAddress(address))
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Private webhook hosts are not allowed",
        422,
      );
    }
  }

  url.hash = "";
  return url.toString();
};
