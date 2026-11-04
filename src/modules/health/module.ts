// Navigation manifest of `health` (SPEC-health "Decisiones"): «Entreno», after Notas (69). It has
// no shortcut (1–8 are taken) and no `bottomNavOrder`, so on the phone it goes under "Más". The id
// `health` stays for when sleep or food come in. Only a description (client-safe data + icon).
import { Dumbbell } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";
import { HEALTH_PATH } from "./routes";

export const healthModule = {
  id: "health",
  label: "Entreno",
  icon: Dumbbell,
  href: HEALTH_PATH,
  navOrder: 70,
  navGroup: "main",
} satisfies ModuleManifest;
