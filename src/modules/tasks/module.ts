// Navigation manifest of `tasks`. Only a description (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order.
import { ListChecks } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/**
 * Tasks (/tasks): inbox and views (SPEC-tasks). Provisional place until the navigation is
 * iterated in Claude Design (SPEC-tasks "Decisiones cerradas" 1): shortcut 3, right after
 * Proyectos; on the phone it takes the cell after the capture key (where "Hábitos" will go).
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
