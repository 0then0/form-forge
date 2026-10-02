import { cn } from "@form-forge/ui";
import Image from "next/image";

export const BrandMark = ({ className }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-flex size-8 shrink-0 items-center justify-center",
      className,
    )}
  >
    <Image
      src="/form-forge-mark.svg"
      alt=""
      width={64}
      height={64}
      className="size-full object-contain"
    />
  </span>
);
