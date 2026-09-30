import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import { keyClasses, type KeyProps } from "./key";
import { Tooltip, type TooltipPlacement } from "./tooltip";

type IconKeyProps = Omit<
  KeyProps,
  "icon" | "iconRight" | "block" | "asChild" | "children" | "aria-label"
> & {
  icon: LucideIcon;
  /** Required accessible name; also shown in the tooltip. */
  label: string;
  round?: boolean;
  /** Show the name + shortcut tooltip on hover/focus (default true). */
  tooltip?: boolean;
  placement?: TooltipPlacement;
};

/** Square icon-only key (design system `IconKey`). Always has an accessible name and a tooltip. */
export function IconKey({
  icon,
  label,
  shortcut,
  size = "md",
  variant = "default",
  round = false,
  toggle = false,
  pressed = false,
  onPressedChange,
  tooltip = true,
  placement = "bottom",
  className,
  onClick,
  type,
  ...props
}: IconKeyProps) {
  const button = (
    <button
      type={type ?? "button"}
      aria-label={label}
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
      className={keyClasses({
        variant,
        size,
        className: cn("bo-key--icon", round && "bo-key--round", className),
      })}
      {...props}
    >
      <Icon icon={icon} size={size === "lg" ? "lg" : size === "sm" ? "sm" : "md"} />
    </button>
  );

  return tooltip ? (
    <Tooltip label={label} shortcut={shortcut} placement={placement} decorative>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
