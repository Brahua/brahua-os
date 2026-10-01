// Navigation manifest of `projects`. Only a description (client-safe data + icon): the registry
// in @/lib/modules decides what shows up and in which order.
import { FolderKanban } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/** Projects (/projects): list, create and, from P2 on, the detail (SPEC-projects). */
export const projectsModule = {
  id: "projects",
  label: "Proyectos",
  icon: FolderKanban,
  href: "/projects",
  navOrder: 20,
  navGroup: "main",
  shortcut: 2,
} satisfies ModuleManifest;
