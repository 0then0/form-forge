import type { DeliveryStatus } from "@/db/schema";

export const deriveDeliveryStatus = (
  statuses: DeliveryStatus[],
): DeliveryStatus => {
  if (statuses.length === 0) return "succeeded";
  if (statuses.every((status) => status === "succeeded")) return "succeeded";
  if (
    statuses.some((status) => status === "pending" || status === "processing")
  ) {
    return "processing";
  }
  return "failed";
};
