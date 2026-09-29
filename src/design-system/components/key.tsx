import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * A physical key: sits on a 4px bottom edge, sinks 3px while pressed and
 * flips to chalk (inverted) when toggled on via `aria-pressed`.
 * Hover styles only apply to fine pointers (Tailwind v4 `hover:` uses `@media (hover: hover)`).
 */
export const keyVariants = cva(
  [
    "inline-flex select-none items-center justify-center gap-2 rounded-lg font-sans font-semibold",
    "transition-[translate,box-shadow,background-color,color] duration-press ease-press",
    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
    "enabled:active:translate-y-[3px] motion-reduce:enabled:active:translate-none",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-surface text-text shadow-key",
          "hover:bg-surface-hover enabled:active:shadow-key-pressed",
          "aria-pressed:translate-y-[3px] aria-pressed:bg-surface-pressed aria-pressed:text-bg aria-pressed:shadow-key-on",
          "motion-reduce:aria-pressed:translate-none",
        ],
        signal: [
          "bg-signal font-bold text-on-signal shadow-key-signal",
          "hover:bg-signal-hover enabled:active:shadow-key-signal-pressed",
        ],
        ghost: [
          "bg-transparent text-text-muted",
          "hover:bg-surface-hover hover:text-text enabled:active:translate-y-0",
        ],
      },
      size: {
        sm: "h-11 px-3 text-body-sm",
        md: "h-12 px-4 text-body",
        lg: "h-14 px-5 text-body",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type KeyProps = React.ComponentProps<"button"> &
  VariantProps<typeof keyVariants> & {
    /** Render the child element (e.g. a Next.js `<Link>`) with key styles. */
    asChild?: boolean;
  };

export function Key({ variant, size, asChild = false, className, type, ...props }: KeyProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      // Default to type="button" so keys never submit forms by accident.
      type={asChild ? type : (type ?? "button")}
      className={cn(keyVariants({ variant, size }), className)}
      {...props}
    />
  );
}

const ICON_KEY_SIZES = { sm: "size-11", md: "size-12", lg: "size-14" } as const;

export type IconKeyProps = Omit<KeyProps, "size" | "aria-label"> & {
  size?: keyof typeof ICON_KEY_SIZES;
  /** Required: icon-only keys have no visible text. */
  "aria-label": string;
};

/** Square key that holds a single icon. */
export function IconKey({ size = "md", className, ...props }: IconKeyProps) {
  return <Key className={cn(ICON_KEY_SIZES[size], "px-0", className)} {...props} />;
}
