import { cn } from "@/lib/cn";
import { AREA_ICONS, type AreaIconName } from "../area-icons";
import { DEFAULT_AREAS, type AreaColor } from "../areas";
import { Icon } from "./icon";
import { Led } from "./led";

type AreaTagProps = Omit<React.ComponentProps<"span">, "children" | "color"> & {
  /** Area palette (color). */
  area: AreaColor;
  /** Area icon; defaults to the palette's default area icon. */
  icon?: AreaIconName;
  /** Area name; defaults to the palette's default area name. */
  label?: string;
  /** inline (metadata), chip (filter) or large (heading). */
  variant?: "inline" | "chip" | "large";
  led?: boolean;
};

/** Area icon + LED + name (design system `AreaTag`). Areas are told apart by icon, never by color alone. */
export function AreaTag({
  area,
  icon,
  label,
  variant = "inline",
  led = true,
  className,
  ...props
}: AreaTagProps) {
  const defaults = DEFAULT_AREAS[area];
  return (
    <span
      className={cn(
        "bo-area-tag",
        `bo-area--${area}`,
        variant !== "inline" && `bo-area-tag--${variant === "large" ? "lg" : "chip"}`,
        className,
      )}
      {...props}
    >
      {led ? <Led area={area} size="sm" /> : null}
      <Icon icon={AREA_ICONS[icon ?? defaults.icon]} size={variant === "large" ? "md" : "xs"} />
      <span>{label ?? defaults.label}</span>
    </span>
  );
}
