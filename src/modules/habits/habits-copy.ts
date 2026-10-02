// User-facing copy of the habits screens (Spanish). Never guilt: no "fallaste", no "perdiste"
// (docs/principios-ux.md, "Lo que no haremos"). H2–H4 add their texts in files of their own
// (e.g. `frequency-copy.ts`, `measure-copy.ts`), not here, so parallel branches don't collide.

export const HABITS_COPY = {
  title: "Hábitos",
  pageTitle: "Hábitos",
  noticesLabel: "Avisos",
  undoHint: "Para deshacer, pulsa Ctrl+Z o ⌘Z, o usa el botón Deshacer del aviso.",
  undo: "Deshacer",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  notSavedTitle: "Sin guardar",

  // "Hoy"
  todayHeading: "Hoy",
  todayCount: (done: number, total: number) => `${done} de ${total} hoy`,
  padsLabel: "Hábitos de hoy",
  padDone: "HECHO",
  emptyTitle: "Todavía no tienes hábitos",
  emptyText:
    "Un hábito se marca con un toque cada día que lo cumples. Empieza con uno pequeño: lo importante es la constancia, no la perfección.",
  emptyCreate: "Crear un hábito",

  // Logging a day
  doneTitle: "Hecho",
  undoneTitle: "Sin marcar",
  done: (name: string) => `«${name}» quedó hecho hoy.`,
  undone: (name: string) => `«${name}» quedó sin marcar hoy.`,
  doneAgain: (name: string) => `«${name}» volvió a quedar hecho.`,
  undoneAgain: (name: string) => `«${name}» volvió a quedar sin marcar.`,
  notLogged: "No se pudo registrar.",
  notUndone: "No se pudo deshacer.",

  // Create
  newHabit: "Nuevo hábito",
  nameLabel: "Nombre",
  nameHelp: "Por ejemplo, «Meditar 10 min» o «Leer».",
  areaLabel: "Área (opcional)",
  noArea: "Sin área",
  areaHint: "El color del área se ve en la luz del hábito.",
  summaryLabel: "Resumen",
  /** H1: every new habit is a daily yes/no. H2 and H3 extend the summary ("Cada día · 8 vasos"). */
  summaryDailyCheck: "Cada día · Sí o no",
  create: "Crear hábito",
  creating: "Creando…",
  creatingStatus: "Creando hábito…",
  cancel: "Cancelar",
  created: (name: string) => `Hábito «${name}» creado.`,
  unexpected: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.",

  // Options and delete
  options: (name: string) => `Opciones de «${name}»`,
  optionsDescription: "Lo que puedes hacer con este hábito.",
  deleteHabit: "Eliminar hábito",
  deleteHelp: "Lo creaste por error: se quita de todas las vistas. Puedes deshacerlo desde el aviso.",
  confirmTitle: (name: string) => `¿Eliminar «${name}»?`,
  confirmText: "Tiene días registrados: se ocultan con él. Puedes deshacerlo desde el aviso.",
  confirmDelete: "Sí, eliminar",
  keep: "No, conservarlo",
  deletedTitle: "Hábito eliminado",
  deleted: (name: string) => `«${name}» se eliminó.`,
  restored: (name: string) => `«${name}» volvió.`,
  notDeleted: "No se pudo eliminar.",
} as const;
