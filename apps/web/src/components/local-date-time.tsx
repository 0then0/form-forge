"use client";

import { useSyncExternalStore } from "react";

import { formatLocalDateTime, formatUtcDateTime } from "@/lib/date-time";

const subscribe = () => () => {};

export const LocalDateTime = ({
  className,
  value,
}: {
  className?: string;
  value: Date | string;
}) => {
  const date = new Date(value);
  const valid = !Number.isNaN(date.getTime());
  const formatted = useSyncExternalStore(
    subscribe,
    () => (valid ? formatLocalDateTime(value) : "Date unavailable"),
    () => (valid ? formatUtcDateTime(date) : "Date unavailable"),
  );

  return (
    <time
      className={className}
      {...(valid ? { dateTime: date.toISOString() } : {})}
    >
      {formatted}
    </time>
  );
};
