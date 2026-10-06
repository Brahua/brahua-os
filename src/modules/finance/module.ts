// Navigation manifest of `finance`. Only a description (client-safe data + icon): the registry in
// @/lib/modules decides what shows up and in which order.
import { Wallet } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

/**
 * Finanzas (/finance): expenses, recurring payments and the month's summary (SPEC-finance).
 * Provisional place until the navigation is designed in Claude Design (SPEC-finance
 * "Navegación"): in the sidebar after Hábitos, shortcut 5; on the phone, under "Más".
 */
export const financeModule = {
  id: "finance",
  label: "Finanzas",
  icon: Wallet,
  href: "/finance",
  navOrder: 50,
  navGroup: "main",
  shortcut: 5,
} satisfies ModuleManifest;
