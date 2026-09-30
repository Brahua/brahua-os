import type { LucideIcon, LucideProps } from "lucide-react";
import { cn } from "@/lib/cn";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

const PX: Record<IconSize, number> = { xs: 14, sm: 16, md: 18, lg: 20, xl: 24 };

export type IconProps = Omit<LucideProps, "size" | "strokeWidth"> & {
  icon: LucideIcon;
  size?: IconSize;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
};

/** Lucide icon, stroke 1.75 (design system `Icon`). Inherits currentColor. */
export function Icon({ icon: Glyph, size = "md", label, className, ...props }: IconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <Glyph
      size={PX[size]}
      strokeWidth={1.75}
      className={cn("bo-icon", size !== "md" && `bo-icon--${size}`, className)}
      {...a11y}
      {...props}
    />
  );
}
