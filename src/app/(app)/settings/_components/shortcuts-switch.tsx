"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Switch } from "@/design-system";
import { shortcutsCookie } from "@/modules/core/nav-preferences";

/**
 * "Atajos de teclado" on/off (WCAG 2.1.4). Writes the `bo_shortcuts` cookie and refreshes the
 * route, so the persistent layout reads it again on the server and the navigation drops (or
 * restores) its listener and hints without a full reload.
 */
export function ShortcutsSwitch({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const switchId = useId();
  const descriptionId = useId();
  const [enabled, setEnabled] = useState(initialEnabled);

  function change(next: boolean) {
    document.cookie = shortcutsCookie(next, window.location.protocol === "https:");
    setEnabled(next);
    router.refresh();
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        {/* A real <label>: it names the switch and clicking it toggles the switch too. */}
        <label htmlFor={switchId} className="bo-text-body-strong cursor-pointer">
          Atajos de teclado
        </label>
        <p id={descriptionId} className="bo-text-body-sm text-text-secondary">
          En pantallas anchas, [ contrae la barra lateral, los números del 1 al 8 abren cada sección
          y C abre la captura rápida. Desactívalos si chocan con tu lector de pantalla o tu control
          por voz.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={change}
        id={switchId}
        aria-describedby={descriptionId}
      />
    </div>
  );
}
