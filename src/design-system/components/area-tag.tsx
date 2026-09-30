import { areaColorVar, type AreaColor } from "@/design-system/area-colors";
import { AREA_ICONS, type AreaIconName } from "@/design-system/area-icons";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import { Led } from "./led";

type AreaTagProps = Omit<React.ComponentProps<"span">, "color"> & {
  name: string;
  color: AreaColor;
  icon: AreaIconName;
  size?: "sm" | "md";
  /** Show the area name next to the icon. When hidden it stays available to screen readers. */
  showName?: boolean;
  /** The tag sits on an activated (inverted) key. */
  on?: boolean;
};

/**
 * Identifies a life area by shape (icon) and color (LED), never by color alone.
 * The icon uses the bright `led` tone on dark surfaces and the `ink` tone on light ones.
 */
export function AreaTag({
  name,
  color,
  icon,
  size = "md",
  showName = true,
  on = false,
  className,
  style,
  ...props
}: AreaTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono uppercase",
        size === "sm" ? "text-label-xs" : "text-label",
        className,
      )}
      style={
        {
          "--led": areaColorVar(color, "led"),
          "--ink": areaColorVar(color, "ink"),
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      <Led color={color} size={size === "sm" ? "sm" : "md"} on={on} />
      <Icon
        icon={AREA_ICONS[icon]}
        size={size === "sm" ? "sm" : "md"}
        className={cn(on ? "text-(--ink) light:text-(--led)" : "text-(--led) light:text-(--ink)")}
      />
      <span className={showName ? undefined : "sr-only"}>{name}</span>
    </span>
  );
}
