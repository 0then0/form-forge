export const DELIVERY_LEASE_MS = 60_000;
const MAX_AUTOMATIC_DELIVERY_ATTEMPTS = 5;

export const isFinalDeliveryAttempt = (
  attemptCount: number,
  manualRetryCount: number,
): boolean =>
  attemptCount >= MAX_AUTOMATIC_DELIVERY_ATTEMPTS * (manualRetryCount + 1);
