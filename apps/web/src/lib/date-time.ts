export const formatUtcDateTime = (value: Date): string =>
  `${value
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "")} UTC`;
