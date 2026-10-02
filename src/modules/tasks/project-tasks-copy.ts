// User-facing copy of tasks in projects (T5, Spanish): the "Tareas" section of a project's page
// and the "Próxima acción" of the task's detail.

const pendingTasks = (n: number) => (n === 1 ? "1 pendiente" : `${n} pendientes`);

export const PROJECT_TASKS_COPY = {
  section: "Tareas",
  /** Accessible name of the heading: the count on screen is a bare number. */
  sectionName: (n: number) => (n === 0 ? "Tareas" : `Tareas, ${pendingTasks(n)}`),
  listLabel: "Tareas pendientes del proyecto",
  empty: "Sin tareas pendientes.",
  emptyOpen: "Sin tareas pendientes. Escribe la primera aquí abajo.",
  noMilestone: "Sin hito",
  closed:
    "El proyecto está cerrado: reábrelo para agregarle tareas o elegir su próxima acción.",

  // Next action (the line above the list and the mark on each row)
  nextLabel: "Próxima acción",
  nextNone: "Sin próxima acción: márcala con la bandera de una tarea.",
  /** The row's toggle (aria-pressed says whether it is). */
  markNext: (title: string) => `Próxima acción: ${title}`,
  marked: (title: string) => `«${title}» es la próxima acción.`,
  unmarked: (title: string) => `«${title}» ya no es la próxima acción.`,
  notMarked: "No se pudo cambiar la próxima acción; volvió a como estaba.",
  /** The undo of completing it reopened the task but couldn't mark it again. */
  notRemarked: (reason: string) =>
    `Volvió a estar pendiente, pero no se pudo volver a marcar como próxima acción. ${reason}`,

  // Inline add
  addForm: "Agregar tarea al proyecto",
  addLabel: "Nueva tarea",
  addHelp: "Enter la agrega y deja el campo listo para otra.",
  milestoneLabel: "Hito",
  milestoneHelp: "Opcional. Se mantiene para las siguientes.",
  add: "Agregar tarea",
  added: (title: string) => `Tarea «${title}» agregada.`,
  addedTo: (title: string, milestone: string) => `Tarea «${title}» agregada a «${milestone}».`,
  notAdded: "No se pudo agregar la tarea.",

  // Recently done (folded)
  doneTitle: "Hechas",
  doneName: (n: number) => `Hechas en los últimos 30 días, ${n}`,
  doneListLabel: "Tareas hechas del proyecto",
  doneEmpty: "Nada hecho en los últimos 30 días.",

  // The task's detail
  detailSection: "Próxima acción",
  detailSwitch: (project: string) => `Es la próxima acción de «${project}»`,
  detailHelp:
    "Una por proyecto: marcarla le quita la marca a la anterior. Al completarla, la marca queda libre.",
  detailDone: "Una tarea hecha no puede ser la próxima acción.",
  detailClosed: "El proyecto está cerrado: no tiene próxima acción.",
  detailSaved: "Se guardó la próxima acción.",
} as const;
