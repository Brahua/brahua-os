// R4: Spanish copy of a habit's reminder time and part of the day (SPEC-reminders "Pantallas →
// Hábito"). Calm, optional, never guilt. Client-safe.
import type { HabitDaypart } from "./habit-constants";

export const REMINDER_ERRORS = {
  timeInvalid: "Escribe una hora válida, como 22:00.",
  timeAvoid: "Un hábito a evitar no lleva hora de aviso.",
  daypartInvalid: "Elige Mañana, Tarde o Noche.",
} as const;

/** The name of each part of the day, in the order "Hoy" lists them. */
export const DAYPART_LABELS: Record<HabitDaypart, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
  evening: "Noche",
};

export const REMINDER_COPY = {
  timeLabel: "Hora del aviso",
  timeHelp: "Opcional. A esa hora te aviso si el hábito toca hoy y aún no lo hiciste.",
  noTime: "Sin hora",
  clearTime: "Quitar hora",
  daypartLabel: "Franja",
  daypartHelp: "Opcional. Agrupa tus hábitos de Hoy por momento del día.",
  noDaypart: "Sin franja",
  /** The accessible name of one band's list of pads. */
  bandList: (label: string) => `Hábitos de la franja ${label.toLowerCase()}`,
  noDaypartList: "Hábitos sin franja",
} as const;
