// User-facing copy of "Saltar hoy" (polish, SPEC-habits "Pausas"): resting a habit for one day.
// Never guilt: it is a rest, the streak waits (docs/principios-ux.md). Client-safe.
import { HABIT_SKIP_REASON } from "./habit-constants";

const days = (count: number) => (count === 1 ? "día" : "días");
const skipped = (count: number) => (count === 1 ? "saltado" : "saltados");

export const SKIP_COPY = {
  /** The key in the options sheet (and the corner sheet of `/`). */
  skipToday: "Saltar hoy",
  skipHelp: "Hoy descansa: no suma ni rompe la racha. Puedes deshacerlo desde el aviso.",
  /** The one-day pause's reason (shown in the pauses list). */
  reason: HABIT_SKIP_REASON,
  /** The `/` corner key's name and its sheet's description. */
  options: (name: string) => `Opciones de «${name}»`,
  /** The LCD notice. */
  noticeTitle: "Descanso",
  rests: (name: string) => `«${name}» descansa hoy.`,
  /** Announced after the "Deshacer". */
  back: (name: string) => `«${name}» volvió a tus hábitos de hoy.`,
  /** The undo found the pause longer than a day: it is left as the owner made it. */
  kept: (name: string) => `La pausa de «${name}» ya dura más de un día: se dejó como estaba.`,
  /** The undo found no pause: another action already left the habit as it is. */
  stillResting: (name: string) => `«${name}» sigue descansando hoy.`,
  /** The undo is older than the 7-day window. */
  tooOld: (name: string) => `El descanso de «${name}» ya es de hace días: no se puede deshacer.`,
  notScheduled: "Este hábito no toca hoy: no hay nada que saltar.",
  notSkipped: "No se pudo saltar.",
  avoidRefused: "Un hábito a evitar no se salta: si hoy no puedes registrarlo, déjalo sin marcar.",
  /** The habit's page: "3 días saltados este mes" (the month's name for another month). */
  monthCount: (count: number, monthName: string | null) =>
    `${count} ${days(count)} ${skipped(count)} ${monthName ? `en ${monthName}` : "este mes"}`,
} as const;
