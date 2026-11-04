"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * A small menu that opens under its key (a set's or an exercise's options): Esc or a tap outside
 * closes it (Esc gives focus back to the key), and `close` closes it after a choice. The key gets
 * `aria-expanded` and `aria-controls` from `keyProps`, the panel its `id` from `panelId`.
 */
export function useRowMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const keyRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (keyRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // This Esc is the menu's, not the notices' (they also listen on the document).
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      keyRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return {
    open,
    close: () => setOpen(false),
    keyProps: {
      ref: keyRef,
      "aria-expanded": open,
      "aria-controls": open ? panelId : undefined,
      onClick: () => setOpen((current) => !current),
    },
    panelProps: { ref: panelRef, id: panelId },
  };
}
