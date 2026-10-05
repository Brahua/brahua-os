"use client";

import { SegmentedControl } from "@/design-system";
import type { CaptureProvider } from "@/lib/quick-capture";
import { NAV_COPY } from "../copy";

type CaptureSwitcherProps = {
  providers: readonly CaptureProvider[];
  /** The provider whose sheet is open. */
  value: string;
  onValueChange: (id: string) => void;
};

/**
 * The switch between the quick captures ("Tarea · Gasto", SPEC-finance "Captura rápida"): a
 * radio group at the top of the open sheet. Picking another one replaces the sheet with that
 * provider's, which takes focus to its first field (on the phone that opens the keyboard: one
 * interaction less). The shell remembers the choice on the device.
 */
export function CaptureSwitcher({ providers, value, onValueChange }: CaptureSwitcherProps) {
  return (
    <SegmentedControl
      mode="radio"
      touch
      label={NAV_COPY.captureKind}
      options={providers.map((provider) => ({ value: provider.id, label: provider.label }))}
      value={value}
      onValueChange={(next) => {
        if (next !== value) onValueChange(next);
      }}
      data-capture-switcher=""
    />
  );
}
