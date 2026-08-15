import type * as React from "react";

import { cn } from "./utils";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
};

export const Badge = ({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
      badgeTones[tone],
      className,
    )}
    {...props}
  />
);

export const Alert = ({
  className,
  tone = "danger",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: "danger" | "info" | "success";
}) => (
  <div
    role={tone === "danger" ? "alert" : "status"}
    className={cn(
      "rounded-lg border px-4 py-3 text-sm",
      tone === "danger" && "border-red-200 bg-red-50 text-red-900",
      tone === "info" && "border-blue-200 bg-blue-50 text-blue-900",
      tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
      className,
    )}
    {...props}
  />
);

export const Skeleton = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    aria-hidden="true"
    className={cn("animate-pulse rounded-md bg-slate-200", className)}
    {...props}
  />
);

export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
    <h2 className="text-base font-semibold text-slate-950">{title}</h2>
    <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
      {description}
    </p>
    {action === undefined ? null : <div className="mt-5">{action}</div>}
  </div>
);
