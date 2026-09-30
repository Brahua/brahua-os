// Public API of the design system. Modules import only from "@/design-system".
export { AREA_ICONS } from "./area-icons";
export {
  AREA_COLORS,
  AREA_ICON_NAMES,
  DEFAULT_AREAS,
  type AreaColor,
  type AreaIconName,
} from "./areas";
export { AreaTag } from "./components/area-tag";
export {
  SegmentedControl,
  Switch,
  TextArea,
  TextField,
  type SegmentOption,
} from "./components/controls";
export { Icon, type IconProps, type IconSize } from "./components/icon";
export { IconKey } from "./components/icon-key";
export { Kbd, type KbdTone } from "./components/kbd";
export { Key, keyClasses, type KeyProps, type KeySize, type KeyVariant } from "./components/key";
export { Lcd, Toast } from "./components/lcd";
export { Led } from "./components/led";
export { ListRow } from "./components/list-row";
export {
  DayCell,
  DotMatrix,
  ProgressRing,
  SegmentBar,
  type DayState,
  type DotMatrixDay,
} from "./components/progress";
export { SectionLabel } from "./components/section-label";
export { Sheet } from "./components/sheet";
export { StatNumber } from "./components/stat-number";
export { Tooltip, type TooltipPlacement } from "./components/tooltip";
export { formatStat, type StatCurrency, type StatKind } from "./stat-format";
export { ThemeProvider, THEMES, type Theme } from "./theme-provider";
