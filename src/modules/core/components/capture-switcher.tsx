"use client";

import { useEffect, useRef } from "react";
import { SegmentedControl } from "@/design-system";
import type { CaptureProvider } from "@/lib/quick-capture";
import { NAV_COPY } from "../copy";

type CaptureSwitcherProps = {
  providers: readonly CaptureProvider[];
  /** The provider whose sheet is open. */
  value: string;
  /** Another provider picked; `byKeyboard` when it came from the arrow keys (or Home/End). */
  onValueChange: (id: string, byKeyboard: boolean) => void;
  /** Focus the checked option once the sheet has opened (the switch was used by keyboard). */
  autoFocus?: boolean;
};

/**
 * The switch between the quick captures ("Tarea · Gasto", SPEC-finance "Captura rápida"): a
 * radio group at the top of the open sheet. Picking another one replaces the sheet with that
 * provider's. With a tap or click, the new sheet focuses its first field (on the phone that opens
 * the keyboard: one interaction less); from the keyboard, focus stays on the switch (WCAG 3.2.2),
 * on the checked option of the new sheet. The shell remembers the choice on the device.
 */
export function CaptureSwitcher({
  providers,
  value,
  onValueChange,
  autoFocus = false,
}: CaptureSwitcherProps) {
  const group = useRef<HTMLDivElement>(null);
  // How the last change was made: arrow keys move the selection; a click (or Space/Enter, which
  // click) doesn't come through onKeyDown with an arrow.
  const byKeyboard = useRef(false);

  useEffect(() => {
    if (!autoFocus) return;
    // After the sheet's own initial focus (its effect runs after this one).
    const timer = window.setTimeout(() => {
      group.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  return (
    <div
      ref={group}
      onKeyDownCapture={(event) => {
        byKeyboard.current = [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          " ",
          "Enter",
        ].includes(event.key);
      }}
      onPointerDownCapture={() => {
        byKeyboard.current = false;
      }}
    >
      <SegmentedControl
        mode="radio"
        touch
        label={NAV_COPY.captureKind}
        options={providers.map((provider) => ({ value: provider.id, label: provider.label }))}
        value={value}
        onValueChange={(next) => {
          if (next !== value) onValueChange(next, byKeyboard.current);
        }}
        data-capture-switcher=""
      />
    </div>
  );
}
