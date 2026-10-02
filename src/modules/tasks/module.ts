// Navigation manifest of `tasks`. Only a description (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order.
import { ListChecks } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/**
 * Tasks (/tasks): inbox and views (SPEC-tasks). Provisional place until the navigation is
 * iterated in Claude Design (SPEC-tasks "Decisiones cerradas" 1): shortcut 3, right after
 * Proyectos. On the phone it is under "Más" since H1 of `habits`: Hábitos took the cell after
 * the capture key that Tareas held until then (SPEC-habits "Navegación").
 */
export const tasksModule = {
  id: "tasks",
  label: "Tareas",
  icon: ListChecks,
  href: "/tasks",
  navOrder: 30,
  navGroup: "main",
  shortcut: 3,
} satisfies ModuleManifest;
