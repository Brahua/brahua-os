// User-facing copy of `weekly-review` (Spanish). The tone has no guilt (docs/principios-ux.md 7 y
// 8, SPEC-weekly-review "Tono"): the ritual starts and ends on what was achieved; what stayed
// open is «Quedaron abiertas», never «atrasadas». No «atrasad…», «riesgo», «fallaste», «deuda»,
// «⚠️» or «racha perdida». tests/modules/weekly-review-copy.test.ts scans EVERY string exported
// here for the forbidden ones, so new copy goes in this file (W2 and W3 add their steps here).
import { REVIEW_NOTE_MAX_LENGTH } from "./review-constants";

export const REVIEW_ERRORS = {
  weekInvalid: "Esa semana no es válida.",
  weekFuture: "Esa semana todavía no empieza.",
  noteTooLong: `Usa ${REVIEW_NOTE_MAX_LENGTH} caracteres como máximo.`,
  noteInvisible: "Quita los caracteres invisibles o de control de la nota.",
} as const;

export const REVIEW_COPY = {
  title: "Revisión",
  pageTitle: "Revisión semanal",
  // The four steps, in order (W2 and W3 render them).
  steps: ["Logros", "Pendientes", "Metas y proyectos", "Próxima semana"],
  // Cards (W4): the invitation.
  inviteTitle: "Semana nueva, pizarra limpia",
  inviteAction: "Cerrar la semana",
} as const;
