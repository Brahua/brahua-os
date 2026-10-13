// Navigation manifest of `weekly-review`, registered in MODULES by W2 (it changes the E2E specs
// and screenshots that show the navigation, see CLAUDE.md "Lessons from goals"). Right after
// Metas (60). It has no shortcut: 1–8 are taken, and no `bottomNavOrder`, so on the phone it goes
// under "Más". Only a description (client-safe data + icon): the registry decides what shows up
// and in which order.
import { CalendarCheck } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";
import { REVIEW_PATH } from "./routes";

export const weeklyReviewModule = {
  id: "weekly-review",
  label: "Revisión",
  icon: CalendarCheck,
  href: REVIEW_PATH,
  navOrder: 65,
  navGroup: "main",
} satisfies ModuleManifest;
