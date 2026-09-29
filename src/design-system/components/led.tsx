import { cva, type VariantProps } from "class-variance-authority";
import { areaColorVar, type AreaColor } from "@/design-system/area-colors";
import { cn } from "@/lib/cn";

/**
 * Life-area LED. `on` means it sits on an activated (inverted) key:
 * - Dark theme: off glows in the bright `led` tone; on uses the flat `ink` tone on the chalk key.
 * - Light theme: glow is invisible on white, so off is a flat `ink` dot; on glows `led` on the black key.
 */
const ledVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    size: { sm: "size-1.5", md: "size-2", lg: "size-2.5" },
    on: {
      false: ["bg-(--led) shadow-[0_0_8px_var(--led)]", "light:bg-(--ink) light:shadow-none"],
      true: [
        "bg-(--ink)",
        "light:bg-(--led) light:shadow-[0_0_0_3px_color-mix(in_srgb,var(--led)_28%,transparent),0_0_12px_color-mix(in_srgb,var(--led)_80%,transparent)]",
      ],
    },
  },
  defaultVariants: { size: "md", on: false },
});

type LedProps = Omit<React.ComponentProps<"span">, "color"> &
  VariantProps<typeof ledVariants> & {
    color: AreaColor;
  };

/** Decorative: pair it with visible text or an accessible name elsewhere. */
export function Led({ color, size, on, className, style, ...props }: LedProps) {
  return (
    <span
      aria-hidden
      data-led={color}
      className={cn(ledVariants({ size, on }), className)}
      style={
        {
          "--led": areaColorVar(color, "led"),
          "--ink": areaColorVar(color, "ink"),
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
