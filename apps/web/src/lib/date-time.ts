export const formatUtcDateTime = (value: Date): string =>
  `${value
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "")} UTC`;

export const formatLocalDateTime = (value: Date | string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
