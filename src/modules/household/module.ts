// Navigation manifest of `household`, registered in MODULES by H1 (it changes the E2E specs and
// screenshots that show the navigation, see CLAUDE.md "Lessons from goals"). After Revisión (65).
// It has no shortcut (1–8 are taken) and no `bottomNavOrder`, so on the phone it goes under
// "Más". Only a description (client-safe data + icon).
import { House } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";
import { HOUSEHOLD_PATH } from "./routes";

export const householdModule = {
  id: "household",
  label: "Hogar",
  icon: House,
  href: HOUSEHOLD_PATH,
  navOrder: 67,
  navGroup: "main",
} satisfies ModuleManifest;
