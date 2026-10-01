"use client";

import {
  AREA_COLORS,
  AREA_ICON_NAMES,
  AREA_ICONS,
  Icon,
  Led,
  type AreaColor,
  type AreaIconName,
} from "@/design-system";
import { AREA_COLOR_LABELS, AREA_ICON_LABELS } from "../areas-copy";
import { RadioGrid, type RadioGridOption } from "./radio-grid";

type PickerProps<T extends string> = {
  value: T | null;
  onValueChange: (value: T) => void;
  labelledBy: string;
  describedBy?: string;
  errorId?: string;
  invalid?: boolean;
  ref?: React.Ref<HTMLDivElement>;
};

const COLOR_OPTIONS: RadioGridOption<AreaColor>[] = AREA_COLORS.map((color) => ({
  value: color,
  label: AREA_COLOR_LABELS[color],
  children: (
    <>
      <Led area={color} size="lg" />
      <span className="truncate">{AREA_COLOR_LABELS[color]}</span>
    </>
  ),
}));

const ICON_OPTIONS: RadioGridOption<AreaIconName>[] = AREA_ICON_NAMES.map((name) => ({
  value: name,
  label: AREA_ICON_LABELS[name],
  children: <Icon icon={AREA_ICONS[name]} size="lg" />,
}));

/** The 8 area palettes as named swatches (LED + color name). */
export function AreaColorPicker(props: PickerProps<AreaColor>) {
  return (
    <RadioGrid
      {...props}
      options={COLOR_OPTIONS}
      required
      className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
      itemClassName="justify-start px-3.5"
    />
  );
}

/** The curated Lucide icons for areas, as a grid of icon keys named in Spanish. */
export function AreaIconPicker(props: PickerProps<AreaIconName>) {
  return (
    <RadioGrid
      {...props}
      options={ICON_OPTIONS}
      titles
      required
      className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2"
      itemClassName="bo-key--icon aspect-square w-full"
    />
  );
}
