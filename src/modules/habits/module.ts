// Navigation manifest of `habits`. Only a description (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order.
import { Repeat } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/**
 * Habits (/habits): "Hoy" with one-tap pads (SPEC-habits). Provisional place until the navigation
 * is iterated in Claude Design (SPEC-habits "Decisiones cerradas" 5): in the sidebar after Tareas,
 * shortcut 4; on the phone it takes the cell after the capture key (`bottomNavOrder` puts it
 * before Tareas there, which moves under "Más").
 */
export const habitsModule = {
  id: "habits",
  label: "Hábitos",
  icon: Repeat,
  href: "/habits",
  navOrder: 40,
  bottomNavOrder: 25,
  navGroup: "main",
  shortcut: 4,
} satisfies ModuleManifest;
