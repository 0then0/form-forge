import { cn } from "@form-forge/ui";
import Image from "next/image";

export const BrandMark = ({ className }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm dark:border-slate-700",
      className,
    )}
  >
    <Image
      src="/form-forge-mark.png"
      alt=""
      width={512}
      height={512}
      className="size-full object-contain"
    />
  </span>
);
