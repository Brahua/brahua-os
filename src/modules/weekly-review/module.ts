// Navigation manifest of `weekly-review`. NOT registered in MODULES yet: W2 adds it to the
// registry in @/lib/modules (navigation changes other E2E specs and screenshots, see CLAUDE.md
// "Lessons from goals"). It has no shortcut: 1–8 are taken. Only a description (client-safe data
// + icon): the registry decides what shows up and in which order.
import { CalendarCheck } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";
import { REVIEW_PATH } from "./routes";

export const weeklyReviewModule = {
  id: "weekly-review",
  label: "Revisión",
  icon: CalendarCheck,
  href: REVIEW_PATH,
  navOrder: 70,
  navGroup: "main",
} satisfies ModuleManifest;
