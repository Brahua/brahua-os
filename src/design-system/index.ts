// Public API of the design system. Modules import only from "@/design-system".
export { AREA_ICON_NAMES, AREA_ICONS, type AreaIconName } from "./area-icons";
export { AREA_COLORS, DEFAULT_AREAS, type AreaColor } from "./areas";
export { AreaTag } from "./components/area-tag";
export { Icon, type IconProps, type IconSize } from "./components/icon";
export { IconKey } from "./components/icon-key";
export { Kbd, type KbdTone } from "./components/kbd";
export { Key, keyClasses, type KeyProps, type KeySize, type KeyVariant } from "./components/key";
export { Led } from "./components/led";
export { SectionLabel } from "./components/section-label";
export { StatNumber } from "./components/stat-number";
export { Tooltip, type TooltipPlacement } from "./components/tooltip";
export { formatStat, type StatCurrency, type StatKind } from "./stat-format";
export { ThemeProvider, THEMES, type Theme } from "./theme-provider";
