// Public API of the design system. Modules import only from "@/design-system".
export { AREA_COLORS, areaColorVar, type AreaColor, type AreaTone } from "./area-colors";
export { AREA_ICON_NAMES, AREA_ICONS, type AreaIconName } from "./area-icons";
export { AreaTag } from "./components/area-tag";
export { Icon, type IconSize } from "./components/icon";
export { IconKey, Key, keyVariants, type IconKeyProps, type KeyProps } from "./components/key";
export { Led } from "./components/led";
export { ListRow } from "./components/list-row";
export { SectionLabel } from "./components/section-label";
export { StatNumber } from "./components/stat-number";
export { formatStat, type StatCurrency, type StatKind } from "./stat-format";
export { ThemeProvider, THEMES, type Theme } from "./theme-provider";
