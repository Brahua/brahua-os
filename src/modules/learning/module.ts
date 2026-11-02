// Navigation manifest of `learning` (SPEC-learning "Supuestos" 1): «Aprendizaje», after Hogar
// (67). It has no shortcut (1–8 are taken) and no `bottomNavOrder`, so on the phone it goes under
// "Más". Only a description (client-safe data + icon).
import { GraduationCap } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";
import { LEARNING_PATH } from "./routes";

export const learningModule = {
  id: "learning",
  label: "Aprendizaje",
  icon: GraduationCap,
  href: LEARNING_PATH,
  navOrder: 68,
  navGroup: "main",
} satisfies ModuleManifest;
