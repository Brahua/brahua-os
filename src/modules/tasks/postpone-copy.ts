// User-facing copy of "Mañana" / "Otro día…" (Spanish). No guilt, never red (principles 5 and 12).
import { formatDateKey } from "@/lib/time";

export const POSTPONE_COPY = {
  tomorrow: "Mañana",
  tomorrowName: (title: string) => `Pasar a mañana: ${title}`,
  pick: "Otro día…",
  pickShort: "Otro día",
  pickName: (title: string) => `Elegir otro día para ${title}`,
  /** The swipe's hint, behind the row. */
  swipeHint: "Mañana",

  // The "Otro día…" sheet
  sheetTitle: "Otro día",
  sheetDescription: (title: string) => `«${title}»: elige cuándo quieres verla.`,
  dayLabel: "Día",
  dayHelp: "Hoy o un día que venga.",
  move: "Mover",
  cancel: "Cancelar",

  // Notices
  movedTitle: "Tarea movida",
  /** "«X» pasa a mañana." / "… a hoy." / "… al 15 oct. 2026." */
  moved: (title: string, day: string, today: string, tomorrow: string) =>
    `«${title}» pasa ${dayPhrase(day, today, tomorrow)}.`,
  undone: (title: string) => `«${title}» volvió a su día.`,

  // Failures
  notMoved: "No se pudo mover la tarea; volvió a como estaba.",
  notUndone: "No se pudo deshacer.",
  dateChanged: "La fecha ya cambió, así que la dejé como está.",
} as const;

/** "a mañana", "a hoy" or "al 15 oct. 2026": where the task goes, by Lima's days. */
export function dayPhrase(day: string, today: string, tomorrow: string): string {
  if (day === tomorrow) return "a mañana";
  if (day === today) return "a hoy";
  return `al ${formatDateKey(day, "short")}`;
}
