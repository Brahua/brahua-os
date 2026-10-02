// User-facing copy of H4: pauses, logging another day and streaks (Spanish). Never guilt: a pause
// is rest, a slip "starts again today", nothing is ever "lost" (docs/principios-ux.md). Client-safe.
import {
  HABIT_LOG_WINDOW_DAYS,
  HABIT_PAUSE_MAX_DAYS,
  HABIT_PAUSE_REASON_MAX_LENGTH,
} from "./habit-constants";
import type { StreakUnit } from "./streak";

const DAY_FORMAT = new Intl.DateTimeFormat("es-PE", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const WEEKDAY_DAY_FORMAT = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const SHORT_WEEKDAY_FORMAT = new Intl.DateTimeFormat("es-PE", {
  weekday: "short",
  day: "numeric",
  timeZone: "UTC",
});

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** "9 de octubre" (a Lima day, YYYY-MM-DD; no time zone shift). */
export const formatPauseDay = (day: string) => DAY_FORMAT.format(asDate(day));

/** "martes, 29 de septiembre" (a Lima day). */
export const formatLongDay = (day: string) => WEEKDAY_DAY_FORMAT.format(asDate(day));

/** "mar 29" (a Lima day), short for a key: the dot of the abbreviation dropped. */
export const formatShortDay = (day: string) =>
  SHORT_WEEKDAY_FORMAT.format(asDate(day)).replace(".", "").replace(",", "");

export const PAUSE_ERRORS = {
  startRequired: "Elige el día en que empieza la pausa.",
  endRequired: "Elige el día en que termina la pausa.",
  endBeforeStart: "La pausa no puede terminar antes de empezar.",
  tooLong: `Una pausa dura hasta ${HABIT_PAUSE_MAX_DAYS} días.`,
  startTooEarly: `Una pausa puede empezar hasta ${HABIT_LOG_WINDOW_DAYS} días atrás.`,
  startTooLate: "Una pausa puede empezar hasta un año adelante.",
  startOutOfWindow: `Una pausa empieza desde ${HABIT_LOG_WINDOW_DAYS} días atrás hasta un año adelante.`,
  reasonTooLong: `Usa ${HABIT_PAUSE_REASON_MAX_LENGTH} caracteres como máximo.`,
  reasonInvisible: "Quita los caracteres invisibles o de control del motivo.",
  overlap: "Esas fechas se cruzan con otra pausa de este hábito. Elige otras.",
  notFound: "Esa pausa ya no existe. Actualiza la página.",
} as const;

const unitText = (count: number, unit: StreakUnit) =>
  unit === "weeks" ? (count === 1 ? "semana" : "semanas") : count === 1 ? "día" : "días";

export const STREAK_COPY = {
  /** The pad's line: "RACHA 8" (days) or "RACHA 3 SEM" (weeks). */
  pad: (count: number, unit: StreakUnit) =>
    unit === "weeks" ? `RACHA ${count} SEM` : `RACHA ${count}`,
  /** Said with the pad: "Racha: 8 días." */
  padHelp: (count: number, unit: StreakUnit) => `Racha: ${count} ${unitText(count, unit)}.`,
  /** A habit to avoid's pad: "12 DÍAS LIMPIO". */
  padClean: (count: number) => `${count} ${count === 1 ? "DÍA" : "DÍAS"} LIMPIO`,
  /** A habit to avoid with a relapse today: never red, never "lost". */
  padStartAgain: "EMPIEZAS DE NUEVO HOY",
  cleanHelp: (count: number) => `${count} ${count === 1 ? "día" : "días"} limpio.`,
  startAgainHelp: "Empiezas de nuevo hoy.",
  /** The notice of a milestone (7, 30, 90, 365): a title and a text of its own per milestone. */
  milestoneTitle: (count: number, unit: StreakUnit) =>
    `¡${count} ${unitText(count, unit)} seguid${unit === "weeks" ? "as" : "os"}!`,
  milestone: (name: string, count: number, unit: StreakUnit, progress: string) => {
    const span = unit === "weeks" ? MILESTONE_WEEKS[count] : MILESTONE_DAYS[count];
    return `«${name}»: ${span ?? `${count} ${unitText(count, unit)} seguidos`}. ${progress}.`;
  },
} as const;

const MILESTONE_DAYS: Record<number, string> = {
  7: "una semana entera, así empieza un hábito",
  30: "un mes completo, ya es parte de tu día",
  90: "tres meses seguidos, esto ya eres tú",
  365: "un año entero, todos los días que tocaban",
};

const MILESTONE_WEEKS: Record<number, string> = {
  7: "siete semanas cumplidas, un ritmo propio",
  30: "treinta semanas cumplidas, más de medio año",
  90: "noventa semanas cumplidas, casi dos años",
  365: "trescientas sesenta y cinco semanas, siete años de constancia",
};

export const PAUSE_COPY = {
  // Options sheet (H4 slot)
  pause: "Pausar",
  pauseHelp: "Por un viaje o una enfermedad: los días en pausa no rompen ni suman a la racha.",
  resume: "Reanudar",
  cancelPause: "Cancelar la pausa",
  /** "En pausa hasta el 9 de octubre · Viaje" */
  pausedUntil: (endDate: string, reason: string | null) =>
    `En pausa hasta el ${formatPauseDay(endDate)}${reason ? ` · ${reason}` : ""}`,
  /** "Pausa del 10 al 20 de octubre · Viaje" (it hasn't started). */
  pauseAhead: (startDate: string, endDate: string, reason: string | null) =>
    `Pausa del ${formatPauseDay(startDate)} al ${formatPauseDay(endDate)}${reason ? ` · ${reason}` : ""}`,
  resumeRow: (name: string) => `Reanudar «${name}»`,

  // Pause sheet
  sheetTitle: (name: string) => `Pausar «${name}»`,
  sheetDescription: `Hasta ${HABIT_PAUSE_MAX_DAYS} días. Los días en pausa no rompen ni suman a la racha.`,
  startLabel: "Desde",
  endLabel: "Hasta (incluido)",
  startHelp: `Desde hoy o hasta ${HABIT_LOG_WINDOW_DAYS} días atrás, o más adelante.`,
  reasonLabel: "Motivo (opcional)",
  reasonHelp: "Por ejemplo, «Viaje» o «Enfermo».",
  save: "Pausar",
  saving: "Pausando…",
  savingStatus: "Pausando el hábito…",
  cancel: "Cancelar",
  /** "Pausa de 7 días" — the live summary. */
  summary: (days: number) => `Pausa de ${days} ${days === 1 ? "día" : "días"}.`,

  // Notices
  pausedTitle: "En pausa",
  paused: (name: string, endDate: string) =>
    `«${name}» quedó en pausa hasta el ${formatPauseDay(endDate)}. Descansa: la racha te espera.`,
  pausedAhead: (name: string, startDate: string, endDate: string) =>
    `«${name}» se pausará del ${formatPauseDay(startDate)} al ${formatPauseDay(endDate)}.`,
  pauseRemoved: (name: string) => `La pausa de «${name}» se quitó.`,
  notPaused: "No se pudo pausar.",
  resumedTitle: "Reanudado",
  resumed: (name: string) => `«${name}» volvió a tus hábitos de hoy.`,
  pauseCancelled: (name: string) => `La pausa de «${name}» se canceló.`,
  pauseBack: (name: string) => `La pausa de «${name}» volvió.`,
  notResumed: "No se pudo reanudar.",

  // "Hoy": the folded "En pausa (N)"
  pausedSection: "En pausa",
  pausedList: "Hábitos en pausa",
  pausedHelp: "No cuentan en el día ni rompen la racha. Reanúdalos cuando quieras.",

  // "Registrar otro día" (options and the adjust sheet in that mode)
  logOtherDay: "Registrar otro día",
  logOtherDayHelp: `Marca o corrige uno de los ${HABIT_LOG_WINDOW_DAYS} días anteriores.`,
  otherDayTitle: (name: string) => `Registrar «${name}»`,
  otherDayDescription: `Uno de los ${HABIT_LOG_WINDOW_DAYS} días anteriores. Un día en pausa se guarda, pero no cuenta.`,
  dayLabel: "Día",
  yesterday: "Ayer",
  doneLabel: "Hecho ese día",
  slipLabel: "Recaída ese día",
  pausedDayNote: "Ese día estaba en pausa: se guarda, pero no cuenta para la racha.",
  loggedTitle: "Registrado",
  logged: (name: string, day: string, state: string) =>
    `«${name}», ${formatLongDay(day)}: ${state}.`,
  loggedAgain: (name: string, day: string, state: string) =>
    `«${name}» volvió a quedar así el ${formatLongDay(day)}: ${state}.`,
  stateDone: "hecho",
  stateNotDone: "sin marcar",
  stateSlip: "recaída registrada",
  stateClean: "sin recaídas",
  stateQuantity: (quantity: number, target: number, unit: string) =>
    `${quantity} de ${target} ${unit}`,
  notLoggedOther: "No se pudo registrar ese día.",
} as const;
