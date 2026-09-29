"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Key } from "@/design-system";

const OPTIONS = [
  { value: "dark", label: "Oscuro" },
  { value: "light", label: "Claro" },
  { value: "system", label: "Sistema" },
] as const;

const subscribe = () => () => {};

/** Preview both themes from the guide. The real theme setting lives in Ajustes (core module). */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  // The stored theme is unknown during SSR; only mark a key as pressed after hydration.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <div role="group" aria-label="Tema" className="flex gap-2">
      {OPTIONS.map((option) => (
        <Key
          key={option.value}
          size="sm"
          aria-pressed={hydrated && theme === option.value}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </Key>
      ))}
    </div>
  );
}
