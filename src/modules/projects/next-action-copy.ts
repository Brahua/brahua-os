// User-facing copy of the next action on a project's card (T5 of `tasks`, Spanish). The card is
// `projects`'; the next action comes from the registered source.

export const NEXT_ACTION_COPY = {
  /** The key's label, as in the Claude Design pattern `ProjectCard` ("SIGUIENTE TAREA"). */
  label: "Siguiente tarea",
  /** The card link's description (heard when tabbing through the cards). */
  description: (title: string) => `Siguiente tarea: ${title}`,
  /** The check that completes it. */
  check: (title: string) => `Hecha: ${title}`,
  checkDescription: (project: string) => `Siguiente tarea de ${project}`,
  completedTitle: "Tarea hecha",
  completed: (title: string) => `«${title}» está hecha.`,
  reopened: (title: string) => `«${title}»:`,
  pendingAgain: (title: string) => `«${title}» volvió a estar pendiente.`,
  undone: (title: string) => `«${title}» volvió a ser la siguiente tarea.`,
  notCompleted: "No se pudo marcar la tarea; volvió a como estaba.",
  notUndone: "No se pudo deshacer.",
} as const;
