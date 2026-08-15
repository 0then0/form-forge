import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { AppError } from "@/lib/errors";

const isPrivateIpv4 = (address: string): boolean => {
  const parts = address.split(".").map(Number);
  const first = parts[0];
  const second = parts[1];
  const third = parts[2];
  if (first === undefined || second === undefined || third === undefined)
    return true;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
};

const mappedIpv4 = (address: string): string | undefined => {
  const tail = address.toLowerCase().match(/^::ffff:(.+)$/)?.[1];
  if (!tail) return undefined;
  if (tail.includes(".")) return tail;
  const groups = tail.split(":");
  if (groups.length !== 2) return undefined;
  const high = Number.parseInt(groups[0] ?? "", 16);
  const low = Number.parseInt(groups[1] ?? "", 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return undefined;
  }
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
};

const isPrivateIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();
  const mapped = mappedIpv4(normalized);
  if (mapped) return isPrivateIpv4(mapped);
  if (normalized.includes(".")) return true;
  const groups = normalized.split(":");
  const first = Number.parseInt(groups[0] ?? "", 16);
  const second = Number.parseInt(groups[1] || "0", 16);
  if (!Number.isInteger(first) || !Number.isInteger(second)) return true;

  const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
  const isIanaSpecialAssignment = first === 0x2001 && second <= 0x01ff;
  const isDocumentation =
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x3fff && second <= 0x0fff);
  const isSixToFour = first === 0x2002;
  return (
    !isGlobalUnicast ||
    isIanaSpecialAssignment ||
    isDocumentation ||
    isSixToFour
  );
};

const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
};

export type ResolvedWebhookTarget = {
  address: string;
  family: 4 | 6;
  url: string;
};

export const resolveWebhookTarget = async (
  rawUrl: string,
): Promise<ResolvedWebhookTarget> => {
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
  let address = hostname;
  let family: 4 | 6 = literalFamily === 6 ? 6 : 4;
  if (!literalFamily) {
    let addresses: Array<{ address: string; family: number }>;
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
    const selected = [...addresses].sort(
      (left, right) => left.family - right.family,
    )[0];
    if (!selected || (selected.family !== 4 && selected.family !== 6)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Webhook host could not be resolved",
        422,
      );
    }
    address = selected.address;
    family = selected.family;
  }

  url.hash = "";
  return { address, family, url: url.toString() };
};

export const validateWebhookUrl = async (rawUrl: string): Promise<string> =>
  (await resolveWebhookTarget(rawUrl)).url;
