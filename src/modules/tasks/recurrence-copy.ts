// User-facing copy of recurrence (T3, Spanish). Its own file so T2 and T4 never touch the same
// lines (HANDOFF "Revisión 1": each task keeps its copy apart from tasks-copy.ts).
import { MONTH_DAY_MAX, RECURRENCE_INTERVAL_MAX } from "./task-constants";

export const RECURRENCE_ERRORS = {
  kind: "Elige cómo se repite.",
  interval: `Escribe un número entero del 1 al ${RECURRENCE_INTERVAL_MAX}.`,
  weekdays: "Elige al menos un día.",
  monthDay: `Escribe un día del 1 al ${MONTH_DAY_MAX}.`,
} as const;

/** The editor's choices (`none` removes the rule). */
export const RECURRENCE_MODES = ["none", "every", "weekdays", "month_day"] as const;
export type RecurrenceMode = (typeof RECURRENCE_MODES)[number];

export const RECURRENCE_COPY = {
  label: "Recurrencia",
  modeLegend: "Se repite",
  modes: {
    none: "No se repite",
    every: "Cada cierto tiempo, desde que la completas",
    weekdays: "Ciertos días de la semana",
    month_day: "Un día de cada mes",
  } satisfies Record<RecurrenceMode, string>,
  intervalLabel: "Cada",
  unitLabel: "Unidad",
  units: {
    every_days: "días",
    every_weeks: "semanas",
    every_months: "meses",
  },
  weekdaysLegend: "Días",
  monthDayLabel: "Día del mes",
  monthDayHelp: "Si el mes es más corto, el último día.",
  summaryNone: "No se repite.",
  /** What completing it today would create. */
  nextIfToday: (day: string) => `Si la completas hoy, la siguiente vence el ${day}.`,
  help: "Al marcarla hecha aparece la siguiente con su nueva fecha.",
  saved: "Se guardó la recurrencia.",
  removed: "Ya no se repite.",
  fieldName: "la recurrencia",

  // The row
  rowDescription: (summary: string) => `Se repite: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`,

  // Complete and undo
  completedNext: (title: string, day: string) => `«${title}» está hecha. La siguiente vence el ${day}.`,
  reopenedRemoved: (title: string) =>
    `«${title}» volvió a estar pendiente y se quitó la siguiente.`,
  reopenedKept: (title: string) =>
    `«${title}» volvió a estar pendiente. La siguiente se quedó porque ya la cambiaste.`,
} as const;
