// Navigation manifest of `goals`. Only a description (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order.
import { Target } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/**
 * Goals (/goals): the year's and the quarter's goals, each with one source of progress
 * (SPEC-goals). Provisional place until the navigation is iterated in Claude Design: last in the
 * sidebar's main group (after Finanzas), shortcut 6 (the free number between Finanzas and Áreas).
 * On the phone it keeps the default bar order, so it goes under "Más" and the existing cells stay.
 */
export const goalsModule = {
  id: "goals",
  label: "Metas",
  icon: Target,
  href: "/goals",
  navOrder: 60,
  navGroup: "main",
  shortcut: 6,
} satisfies ModuleManifest;
