// User-facing copy of `weekly-review` (Spanish). The tone has no guilt (docs/principios-ux.md 7 y
// 8, SPEC-weekly-review "Tono"): the ritual starts and ends on what was achieved; what stayed
// open is «Quedaron abiertas», never «atrasadas». No «atrasad…», «riesgo», «fallaste», «deuda»,
// «⚠️» or «racha perdida». tests/modules/weekly-review-copy.test.ts scans EVERY string exported
// here for the forbidden ones, so new copy goes in this file (W2 and W3 add their steps here).
import { REVIEW_NOTE_MAX_LENGTH, REVIEW_OBJECTIVE_MAX_LENGTH } from "./review-constants";

export const REVIEW_ERRORS = {
  weekInvalid: "Esa semana no es válida.",
  weekFuture: "Esa semana todavía no empieza.",
  noteTooLong: `Usa ${REVIEW_NOTE_MAX_LENGTH} caracteres como máximo.`,
  noteInvisible: "Quita los caracteres invisibles o de control de la nota.",
  objectiveTooLong: `El objetivo admite ${REVIEW_OBJECTIVE_MAX_LENGTH} caracteres como máximo.`,
  objectiveInvisible: "Quita los caracteres invisibles o de control del objetivo.",
  notSaved: "No se pudo cerrar la semana. Lo que escribiste sigue aquí.",
} as const;

export const REVIEW_COPY = {
  title: "Revisión",
  pageTitle: "Revisión semanal",
  // The four steps, in order (the progress shows them; W3 fills steps 3 and 4).
  steps: ["Logros", "Pendientes", "Metas y proyectos", "Próxima semana"],
  // Cards (W4): the invitation.
  inviteTitle: "Semana nueva, pizarra limpia",
  inviteAction: "Cerrar la semana",

  // The shell of every step (W2)
  stepsNav: "Pasos de la revisión",
  stepPosition: (step: number | string, total: number | string) => `Paso ${step} de ${total}`,
  back: "Atrás",
  next: "Seguir",
  viewCurrentWeek: "Ver esta semana",
  noticesLabel: "Avisos de la revisión",
  undoHint: "Para deshacer, pulsa Ctrl+Z o ⌘Z, o usa el botón Deshacer del aviso.",
  undo: "Deshacer",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  notSavedTitle: "Sin guardar",
  newDay: "Empezó un nuevo día: actualizando la revisión.",
} as const;

/** Step 1 · Logros: what the week held. No comparisons, no zeros that scold. */
export const LOGROS_COPY = {
  completeDays: (count: number | string) => `Días completos esta semana: ${count}`,
  habits: "hábitos",
  tasksDone: "tareas hechas",
  milestones: "hitos de proyectos",
  goals: "metas logradas",
  /** "18 de 24" (the figure of the habits). */
  habitsFigure: (done: number | string, expected: number | string) => `${done} de ${expected}`,
  noHabitsFigure: "—",
  quietTitle: "Una semana tranquila",
  quietText: "No hay nada que contar esta vez, y está bien. Descansar también es parte del ritmo.",
  habitsHighlights: "Los hábitos más constantes",
  habitLine: (name: string, done: number | string, expected: number | string) =>
    `${name} · ${done} de ${expected}`,
  tasksHighlights: "Tareas hechas hace poco",
  milestonesHighlights: "Hitos cumplidos",
  milestoneLine: (title: string, project: string) => `${title} · ${project}`,
  goalsHighlights: "Metas logradas",
} as const;

/** Step 2 · Pendientes: «Quedaron abiertas», never «atrasadas». */
export const PENDIENTES_COPY = {
  open: (count: number | string) =>
    Number(count) === 1 ? "Quedó abierta 1 tarea." : `Quedaron abiertas ${count} tareas.`,
  emptyTitle: "Nada abierto. Buen cierre.",
  emptyText: "Todo lo de esta semana quedó resuelto o ya tiene otro día.",
  /** The list shows the first 200 of the open ones. */
  shownOf: (shown: number | string, total: number | string) =>
    `Se muestran las primeras ${shown} de ${total}.`,
  moveAll: (count: number | string) =>
    Number(count) === 1 ? "Mover la tarea al lunes" : `Mover las ${count} al lunes`,
  moveAllNone: "Nada que mover al lunes",
  moveAllHelp: "Las que marques «Dejar» se quedan donde están.",
  tomorrow: "Mañana",
  tomorrowName: (title: string, day: string) => `Pasar «${title}» al ${day}`,
  pick: "Otro día…",
  pickName: (title: string) => `Elegir otro día para «${title}»`,
  leave: "Dejar",
  leaveName: (title: string) => `Dejar «${title}» donde está`,
  leftNote: "Se queda donde está.",
  dueOn: (day: string) => `Para el ${day}`,
  recurring: "Se repite: se mueve solo esta vez",
  // «Otro día…»
  dayLabel: "¿Para qué día?",
  dayHelp: "Hoy o un día que venga.",
  moveDay: "Mover",
  cancel: "Cancelar",
  inbox: (count: number | string) => `${count} en la bandeja`,
  inboxProcess: "Procesar",
  inboxName: (count: number | string) => `Procesar ${count} en la bandeja`,
  // Notices
  movedTitle: "Tareas movidas",
  moved: (count: number | string) =>
    Number(count) === 1 ? "Se movió 1 tarea." : `Se movieron ${count} tareas.`,
  /** Added when some of the batch did not move (they changed meanwhile). */
  stayed: (count: number | string) =>
    Number(count) === 1
      ? "1 se quedó donde estaba: cambió mientras tanto."
      : `${count} se quedaron donde estaban: cambiaron mientras tanto.`,
  nothingMoved: "No se movió ninguna: cambiaron mientras tanto.",
  undone: (count: number | string) =>
    Number(count) === 1 ? "La tarea volvió a su día." : `${count} tareas volvieron a su día.`,
  /** "2 volvieron a su día. 1 no se restauró: cambió mientras tanto." */
  undonePartial: (restored: number | string, notRestored: number | string) =>
    `${Number(restored) === 1 ? "1 volvió a su día" : `${restored} volvieron a su día`}. ${
      Number(notRestored) === 1
        ? "1 no se restauró: cambió mientras tanto."
        : `${notRestored} no se restauraron: cambiaron mientras tanto.`
    }`,
  notRestored: (count: number | string) =>
    Number(count) === 1
      ? "1 no se restauró: cambió mientras tanto."
      : `${count} no se restauraron: cambiaron mientras tanto.`,
  notMoved: "No se pudo mover; siguen como estaban.",
  notUndone: "No se pudo deshacer.",
} as const;

/** Step 3 · Metas y proyectos: read-only, with the facts (a block is «Esperando a…», not a reproach). */
export const METAS_COPY = {
  goalsTitle: "Metas",
  goalsEmptyTitle: "Aún no tienes metas activas",
  goalsEmptyText: "Cuando quieras, pon una meta para este año o este trimestre.",
  goalsEmptyLink: "Ir a Metas",
  goalsAll: "Ver todas las metas",
  goalBar: (title: string, count: string) => `${title}: ${count}`,
  projectsTitle: "Proyectos",
  projectsEmptyTitle: "Aún no tienes proyectos en marcha",
  projectsEmptyText: "Los proyectos que empieces aparecerán aquí con su próxima acción.",
  projectsEmptyLink: "Ir a Proyectos",
  projectsAll: "Ver todos los proyectos",
  progress: (percent: number | string) => `${percent} % completado`,
  nextAction: (title: string) => `Siguiente: ${title}`,
  noNextAction: "Sin siguiente acción por ahora",
  waitingFor: (names: string) => `Esperando a ${names}`,
  status: {
    idea: "Idea",
    active: "Activo",
    paused: "Pausado",
    maintenance: "Mantenimiento",
  } as Record<string, string>,
  /** The list shows the first N of M. */
  shownOf: (shown: number | string, total: number | string) =>
    `Se muestran los primeros ${shown} de ${total}.`,
} as const;

/** Step 4 · Próxima semana and the close. */
export const PROXIMA_COPY = {
  objectiveLabel: (range: string) => `Objetivo de la semana del ${range}`,
  objectiveHelp: `Una sola cosa para la semana que viene (hasta ${REVIEW_OBJECTIVE_MAX_LENGTH} caracteres). Es el mismo objetivo que ves en Metas.`,
  objectiveExisting: "Ya tenías este objetivo. Si lo cambias, también cambia en Metas.",
  noteLabel: "Nota de esta semana (opcional)",
  noteHelp: `¿Qué aprendiste? Hasta ${REVIEW_NOTE_MAX_LENGTH} caracteres.`,
  close: "Cerrar la semana",
  closed: "Esta semana ya está cerrada",
  closedHelp: "Puedes cambiar la nota o el objetivo y guardar de nuevo.",
  closeAgain: "Guardar cambios",
  saving: "Guardando…",
  announceClosed: "Semana cerrada.",
  announceUpdated: "Cambios guardados.",
} as const;

/** The closing screen: it ends on what was achieved. */
export const CIERRE_COPY = {
  title: "Semana cerrada",
  subtitle: "Cerraste una semana más. Esto es lo que lograste:",
  noteTitle: "Tu nota",
  objectiveTitle: "Tu objetivo de la próxima semana",
  backToToday: "Volver a Hoy",
} as const;

/** «Semanas anteriores»: dates, the figures and the note. No guilt, no comparisons. */
export const HISTORIAL_COPY = {
  title: "Semanas anteriores",
  empty: "Cuando cierres tu primera semana, aparecerá aquí.",
  completeDays: (count: number | string) => `Días completos: ${count}`,
  habits: (done: number | string, expected: number | string) => `${done} de ${expected} hábitos`,
  noHabits: "Sin hábitos esa semana",
  note: (text: string) => `Nota: ${text}`,
} as const;
