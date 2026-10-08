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
  /** The batch of the evening close: "3 tareas pasan a mañana." */
  movedManyTitle: "Tareas movidas",
  movedMany: (count: number, day: string, today: string, tomorrow: string) =>
    `${count} ${count === 1 ? "tarea pasa" : "tareas pasan"} ${dayPhrase(day, today, tomorrow)}.`,
  undoneMany: (count: number) =>
    count === 1 ? "La tarea volvió a su día." : `${count} tareas volvieron a su día.`,

  // Failures
  notMoved: "No se pudo mover la tarea; volvió a como estaba.",
  /** Added to the batch's notice when some tasks moved and some did not. */
  notMovedSome: (count: number) =>
    count === 1 ? "Una no se pudo mover." : `${count} no se pudieron mover.`,
  notMovedMany: (count: number) =>
    count === 1
      ? "No se pudo mover una tarea; volvió a como estaba."
      : `No se pudieron mover ${count} tareas; volvieron a como estaban.`,
  notUndone: "No se pudo deshacer.",
  dateChanged: "La fecha ya cambió, así que la dejé como está.",
} as const;

/** "a mañana", "a hoy" or "al 15 oct. 2026": where the task goes, by Lima's days. */
export function dayPhrase(day: string, today: string, tomorrow: string): string {
  if (day === tomorrow) return "a mañana";
  if (day === today) return "a hoy";
  return `al ${formatDateKey(day, "short")}`;
}
