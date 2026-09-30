// Navigation manifests of `core`. Only descriptions (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order.
import { LayoutGrid, Settings, Sun } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/** Provisional home ("Hoy") until the `today` module takes over "/". */
export const homeModule = {
  id: "home",
  label: "Hoy",
  icon: Sun,
  href: "/",
  navOrder: 10,
  shortcut: 1,
} satisfies ModuleManifest;

/** Life areas: C5 builds /areas and switches it to available. */
export const areasModule = {
  id: "areas",
  label: "Áreas",
  icon: LayoutGrid,
  href: "/areas",
  navOrder: 10,
  navGroup: "footer",
  shortcut: 7,
  status: "planned",
} satisfies ModuleManifest;

/** Settings: C4 builds /settings and switches it to available. */
export const settingsModule = {
  id: "settings",
  label: "Ajustes",
  icon: Settings,
  href: "/settings",
  navOrder: 20,
  navGroup: "footer",
  shortcut: 8,
  status: "planned",
} satisfies ModuleManifest;
