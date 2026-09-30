import { Slot } from "@radix-ui/react-slot";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon, type IconSize } from "./icon";
import { Kbd } from "./kbd";

export type KeyVariant = "default" | "signal" | "ghost";
export type KeySize = "sm" | "md" | "lg";

const ICON_SIZE: Record<KeySize, IconSize> = { sm: "sm", md: "md", lg: "lg" };

export type KeyProps = Omit<React.ComponentProps<"button">, "onClick"> & {
  variant?: KeyVariant;
  /** sm 36 px (desktop with a pointer only) · md 48 px · lg 58 px */
  size?: KeySize;
  /** Toggle mode: exposes aria-pressed and stays sunk and inverted while pressed. */
  toggle?: boolean;
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Lucide icon on the left. */
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /** Shortcut shown as Kbd: "C" or ["⌘", "↵"]. */
  shortcut?: string | string[];
  block?: boolean;
  /** Render the child element (e.g. a Next.js Link) with key styles. */
  asChild?: boolean;
};

export function keyClasses({
  variant = "default",
  size = "md",
  block = false,
  className,
}: Pick<KeyProps, "variant" | "size" | "block" | "className">) {
  return cn(
    "bo-key",
    variant !== "default" && `bo-key--${variant}`,
    size !== "md" && `bo-key--${size}`,
    block && "bo-key--block",
    className,
  );
}

/** Physical key (design system `Key`): sinks 3 px when pressed; in toggle mode it inverts while on. */
export function Key({
  variant = "default",
  size = "md",
  toggle = false,
  pressed = false,
  onPressedChange,
  icon,
  iconRight,
  shortcut,
  block = false,
  asChild = false,
  className,
  children,
  onClick,
  type,
  ...props
}: KeyProps) {
  const classes = keyClasses({ variant, size, block, className });

  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      type={type ?? "button"}
      aria-pressed={toggle ? pressed : undefined}
      // Only attach a handler when there is one: static keys stay renderable from Server Components.
      onClick={
        onClick || (toggle && onPressedChange)
          ? (event) => {
              if (toggle) onPressedChange?.(!pressed);
              onClick?.(event);
            }
          : undefined
      }
      className={classes}
      {...props}
    >
      {icon ? <Icon icon={icon} size={ICON_SIZE[size]} /> : null}
      {children}
      {iconRight ? <Icon icon={iconRight} size={ICON_SIZE[size]} /> : null}
      {shortcut ? (
        <Kbd keys={shortcut} tone={variant === "signal" ? "signal" : "default"} aria-hidden />
      ) : null}
    </button>
  );
}
