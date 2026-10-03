// Navigation manifests of `core`. Only descriptions (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order. "Hoy" (/) belongs to `today`
// (src/modules/today/module.ts).
import { LayoutGrid, Settings } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/** Life areas (/areas): list, create and edit (C5). */
export const areasModule = {
  id: "areas",
  label: "Áreas",
  icon: LayoutGrid,
  href: "/areas",
  navOrder: 10,
  navGroup: "footer",
  shortcut: 7,
} satisfies ModuleManifest;

/** Settings (/settings): theme, keyboard shortcuts, passkeys and session. */
export const settingsModule = {
  id: "settings",
  label: "Ajustes",
  icon: Settings,
  href: "/settings",
  navOrder: 20,
  navGroup: "footer",
  shortcut: 8,
} satisfies ModuleManifest;
