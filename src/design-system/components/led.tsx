import { cn } from "@/lib/cn";
import type { AreaColor } from "../areas";

type LedProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** Area palette. Omit it for a neutral LED. */
  area?: AreaColor;
  /** Lit: adds the halo. */
  on?: boolean;
  /** Orange signal LED instead of an area color. */
  signal?: boolean;
  size?: "sm" | "md" | "lg";
};

/**
 * Area LED (design system `Led`). On an activated key it switches to the inverse tone
 * automatically via CSS. Decorative: pair it with visible text.
 */
export function Led({
  area,
  on = false,
  signal = false,
  size = "md",
  className,
  ...props
}: LedProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "bo-led",
        size !== "md" && `bo-led--${size}`,
        signal ? "bo-led--signal" : area && `bo-area--${area}`,
        on && "is-on",
        className,
      )}
      {...props}
    />
  );
}
