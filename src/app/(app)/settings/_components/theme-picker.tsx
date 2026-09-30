"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { SegmentedControl, type SegmentOption } from "@/design-system";

export type ThemePreference = "dark" | "light" | "system";

const OPTIONS: SegmentOption<ThemePreference>[] = [
  { value: "dark", label: "Oscuro" },
  { value: "light", label: "Claro" },
  { value: "system", label: "Sistema" },
];

const noop = () => () => {};

/** False on the server and during hydration, true once mounted in the browser. */
function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/** Narrows next-themes' stored value to a known preference (anything else: the default, dark). */
export function themePreference(value: string | undefined): ThemePreference {
  return value === "light" || value === "system" ? value : "dark";
}

/**
 * Theme picker (Oscuro, Claro o Sistema): a radio group, arrow keys move the selection.
 * next-themes keeps the choice in localStorage and applies it before the first paint (inline
 * script), so a reload never flashes the wrong theme. The stored value is only known in the
 * browser: until mounted the group keeps its place but stays invisible, so it never shows a
 * wrong selection.
 */
export function ThemePicker({
  labelledBy,
  describedBy,
}: {
  /** Id of the visible heading that names the group. */
  labelledBy: string;
  /** Id of the hint that explains the options. */
  describedBy?: string;
}) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <SegmentedControl
      // A fresh group once mounted: updating the placeholder would animate the selected key
      // from the placeholder value to the stored one.
      key={mounted ? "mounted" : "placeholder"}
      mode="radio"
      touch
      // Named by the visible heading, not a hidden aria-label (the component requires `label`).
      label="Tema"
      aria-label={undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      options={OPTIONS}
      // Hydration must match the server HTML, which can't know the stored theme: React would
      // keep the server's aria-checked. So a fixed value until mounted, then the real one.
      value={mounted ? themePreference(theme) : "dark"}
      onValueChange={setTheme}
      className={mounted ? undefined : "invisible"}
      aria-hidden={mounted ? undefined : true}
    />
  );
}
