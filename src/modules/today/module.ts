// Navigation manifest of `today`. Only a description (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order.
import { Sun } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";
import { HOME_PATH } from "@/lib/routes";

/**
 * Hoy (/): the daily board (SPEC-today). It took over the home page from `core`'s provisional
 * manifest with the same id, place and shortcut, so the navigation doesn't change.
 */
export const todayModule = {
  id: "home",
  label: "Hoy",
  icon: Sun,
  href: HOME_PATH,
  navOrder: 10,
  shortcut: 1,
} satisfies ModuleManifest;
