// Navigation manifest of `notes` (SPEC-notes "Supuestos" 1): «Notas», after Aprendizaje (68). It has
// no number shortcut (1–8 are taken; `N` opens today's note, src/lib/shortcuts.ts) and no
// `bottomNavOrder`, so on the phone it goes under "Más". Only a description (client-safe data +
// icon).
import { NotebookPen } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";
import { NOTES_PATH } from "./routes";

export const notesModule = {
  id: "notes",
  label: "Notas",
  icon: NotebookPen,
  href: NOTES_PATH,
  navOrder: 69,
  navGroup: "main",
} satisfies ModuleManifest;
