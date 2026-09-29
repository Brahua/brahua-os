import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/cn";

const ICON_SIZES = { sm: 16, md: 18, lg: 20, xl: 24 } as const;

export type IconSize = keyof typeof ICON_SIZES;

type IconProps = Omit<LucideProps, "size" | "strokeWidth"> & {
  icon: LucideIcon;
  size?: IconSize;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string;
};

/** Lucide icon with the system's stroke (1.75) and sizes. Inherits `currentColor`. */
export function Icon({ icon: IconComponent, size = "md", label, className, ...props }: IconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };

  return (
    <IconComponent
      size={ICON_SIZES[size]}
      strokeWidth={1.75}
      className={cn("shrink-0", className)}
      {...a11y}
      {...props}
    />
  );
}
