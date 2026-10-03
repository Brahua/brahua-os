// User-facing copy of H5 (Spanish): the "Semana" view, a habit's page (stats, calendar, pauses,
// actions) and "Más detalles" of the form. Never guilt: a day not met is empty, a paused one is
// rest, nothing is "lost" or "failed" (docs/principios-ux.md). Client-safe.
import {
  HABIT_CUE_MAX_LENGTH,
  HABIT_IDENTITY_MAX_LENGTH,
  HABIT_LOG_WINDOW_DAYS,
} from "./habit-constants";
import { formatDayName, formatPauseDay } from "./pause-copy";
import type { StreakUnit } from "./streak";

const MONTH_FORMAT = new Intl.DateTimeFormat("es-PE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "septiembre de 2026" (a month, YYYY-MM). */
export const formatMonth = (month: string) =>
  MONTH_FORMAT.format(new Date(`${month}-01T00:00:00Z`));

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("es-PE") + text.slice(1);

/** The weekday letters under the week's dots and over the calendar, Monday first. */
export const WEEKDAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"] as const;

/** Their full names (the calendar's column headers say them). */
export const WEEKDAY_FULL = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

const days = (count: number) => (count === 1 ? "día" : "días");
const unitWord = (count: number, unit: StreakUnit) =>
  unit === "weeks" ? (count === 1 ? "semana" : "semanas") : days(count);

export const DETAILS_ERRORS = {
  identityTooLong: `Usa ${HABIT_IDENTITY_MAX_LENGTH} caracteres como máximo.`,
  identityInvisible: "Quita los caracteres invisibles o de control de la frase.",
  cueTooLong: `Usa ${HABIT_CUE_MAX_LENGTH} caracteres como máximo.`,
  cueInvisible: "Quita los caracteres invisibles o de control del momento.",
  startDateInvalid: "Elige una fecha válida.",
  startDateFuture: "Un hábito empieza hoy o en uno de los días anteriores, no más adelante.",
  startDateTooEarly: `Puede empezar hasta ${HABIT_LOG_WINDOW_DAYS} días atrás.`,
  startDateOutOfWindow: `Un hábito empieza hoy o hasta ${HABIT_LOG_WINDOW_DAYS} días atrás.`,
} as const;

/** What a day of a habit says (the week's list for screen readers, the calendar's keys). */
export type DayText = {
  status: "beforeStart" | "future" | "paused" | "notScheduled" | "done" | "partial" | "empty";
  kind: "build" | "avoid";
  quantity: number | null;
  target: number;
  unit: string | null;
};

/** "hecho", "6 de 8 vasos", "descanso (en pausa)", "sin recaídas"… never "fallado". */
export function dayStateText({ status, kind, quantity, target, unit }: DayText): string {
  const amount = quantity === null ? null : `${quantity} de ${target} ${unit ?? ""}`.trim();
  switch (status) {
    case "beforeStart":
      return "antes de empezar";
    case "future":
      return "por venir";
    case "paused":
      return "descanso (en pausa)";
    case "notScheduled":
      return "no toca ese día";
    case "done":
      if (kind === "avoid") return "sin recaídas";
      return amount ? `hecho, ${amount}` : "hecho";
    case "partial":
      return amount ?? "en progreso";
    case "empty":
      if (kind === "avoid") return "con recaída";
      return amount ?? "sin marcar";
  }
}

export const HISTORY_COPY = {
  // The views of /habits
  viewsLabel: "Vistas de hábitos",
  viewToday: "Hoy",
  viewWeek: "Semana",
  weekPageTitle: "Semana · Hábitos · brahua-os",

  // "Semana"
  weekHeading: "Semana",
  /** "Del 28 de setiembre al 4 de octubre", "Del 21 al 27 de setiembre" (es-PE month names). */
  weekRange: (monday: string, sunday: string) =>
    `Del ${monday.slice(0, 7) === sunday.slice(0, 7) ? Number(monday.slice(8)) : formatPauseDay(monday)} al ${formatPauseDay(sunday)}`,
  thisWeek: "esta semana",
  thatWeek: "esa semana",
  /** The total's unit next to its number: "de 24". */
  ofTotal: (expected: number) => `de ${expected}`,
  weekTotalLabel: "Total de la semana",
  previousWeek: "Semana anterior",
  nextWeek: "Semana siguiente",
  backToThisWeek: "Volver a esta semana",
  weekNav: "Cambiar de semana",
  weekListLabel: "Tus hábitos esta semana",
  /** "5 de 7"; nothing that counts yet (a paused week, a Monday not done yet): said plainly. */
  compliance: (done: number, expected: number) =>
    expected === 0 ? "Sin días que cuenten" : `${done} de ${expected}`,
  complianceHelp: (done: number, expected: number) =>
    expected === 0 ? "Sin días que cuenten." : `Cumplimiento: ${done} de ${expected}.`,
  weekDaysLabel: (name: string) => `Días de «${name}»`,
  noHabitsThatWeek: "Esa semana no tenías hábitos activos.",
  noHabitsYet: "Todavía no tienes hábitos activos. Créalos desde «Hoy».",
  goToday: "Ir a Hoy",
  /** A day in the week's list for screen readers: "martes 29 de septiembre (hoy): hecho". */
  dayLine: (day: string, today: boolean, state: string) =>
    `${formatDayName(day)}${today ? " (hoy)" : ""}: ${state}`,

  // A habit's page
  backToList: "Hábitos",
  notFoundTitle: "Hábito no encontrado · brahua-os",
  notFoundLcd: "No encontramos este hábito.",
  notFoundHeading: "Este hábito no está",
  notFoundText:
    "Puede que lo hayas eliminado o que el enlace esté incompleto. Tus otros hábitos siguen en su lugar.",
  openPage: "Ver historial y detalles",
  openPageHelp: "Su calendario, sus rachas y sus pausas.",
  identityLabel: "Identidad",
  cueLabel: "Momento",
  areaLabel: "Área",
  noArea: "Sin área",
  rulesLabel: "Regla",
  startedOn: (day: string) => `Empezó el ${formatPauseDay(day)}`,
  archivedNote:
    "Está archivado: no aparece en «Hoy» ni en «Semana» y se conserva todo. Reactívalo para registrarlo, editarlo o pausarlo.",

  // Stats
  statsLabel: "Estadísticas",
  currentStreak: "Racha actual",
  bestStreak: "Mejor racha",
  cleanStreak: "Días limpio seguidos",
  bestClean: "Mejor racha limpio",
  streakUnit: (count: number, unit: StreakUnit) => unitWord(count, unit),
  monthCompliance: "Cumplimiento del mes",
  monthComplianceOf: (done: number, expected: number) =>
    expected === 0 ? "Sin días que cuenten" : `${done} de ${expected}`,
  /** "42 días · hechos en total" (principle 10: the evidence adds up). */
  totalLabel: "Hechos en total",
  totalCleanLabel: "Limpio en total",
  totalUnit: (count: number) => days(count),

  // Calendar
  calendarHeading: "Calendario",
  /** "Septiembre de 2026". */
  monthTitle: (month: string) => capitalize(formatMonth(month)),
  previousMonth: "Mes anterior",
  nextMonth: "Mes siguiente",
  monthNav: "Cambiar de mes",
  calendarHelp: `Usa las flechas para moverte. Hoy y los ${HABIT_LOG_WINDOW_DAYS} días anteriores se pueden marcar o corregir.`,
  calendarHelpArchived: "Usa las flechas para moverte. Reactívalo para marcar o corregir un día.",
  /** A day key's name: "martes 29 de septiembre: 6 de 8 vasos" (plus "hoy"). */
  dayKey: (day: string, today: boolean, state: string) =>
    `${formatDayName(day)}${today ? " (hoy)" : ""}: ${state}`,
  dayReadOnly: "Solo lectura: ya no se puede corregir.",
  /** The adjust sheet opened from the calendar: today is offered too. */
  todayKey: "Hoy",
  dayDescription: `Hoy o uno de los ${HABIT_LOG_WINDOW_DAYS} días anteriores. Un día en pausa se guarda, pero no cuenta.`,

  // Pauses
  pausesHeading: "Pausas",
  noPauses: "Sin pausas actuales ni planeadas.",
  pausesHelp: "Los días en pausa no rompen ni suman a la racha.",
  pausesList: "Pausas actuales y planeadas",
  pastPauses: "Pausas pasadas",
  pastPausesList: "Pausas pasadas",
  /** "Del 10 al 20 de octubre · Viaje" */
  pauseRange: (startDate: string, endDate: string, reason: string | null) =>
    `Del ${formatPauseDay(startDate)} al ${formatPauseDay(endDate)}${reason ? ` · ${reason}` : ""}`,
  pauseNow: "En curso",
  pauseAhead: "Planeada",
  resumeHelp: (range: string) => `Reanudar: ${range}`,
  cancelHelp: (range: string) => `Cancelar la pausa: ${range}`,

  // Actions
  actionsHeading: "Acciones",
  edit: "Editar",
  archive: "Archivar",
  archiveHelp: "Lo terminaste o lo dejas por ahora: sale de «Hoy» y «Semana» y conserva todo.",
  reactivate: "Reactivar",
  reactivateHelp: "Vuelve al final de «Hoy».",
  deleteHelp:
    "Lo creaste por error: se quita de todas las vistas. Puedes deshacerlo desde el aviso.",
  deleting: "Eliminando…",
  notDeletedNow: "No se pudo eliminar.",

  // "Más detalles" (form)
  moreDetails: "Más detalles",
  moreDetailsHelp: "Identidad, momento y fecha de inicio (opcionales).",
  moreDetailsEditHelp: "Identidad y momento (opcionales).",
  identityField: "Identidad (opcional)",
  identityHelp: "Quién quieres ser, por ejemplo «Soy alguien que lee».",
  cueField: "Momento (opcional)",
  cueHelp: "Cuándo o después de qué, por ejemplo «Después del desayuno».",
  startDateField: "Fecha de inicio",
  startDateHelp: `Hoy o hasta ${HABIT_LOG_WINDOW_DAYS} días atrás: antes no hay días que cuenten.`,
} as const;
