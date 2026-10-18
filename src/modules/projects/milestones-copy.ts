// User-facing copy of a project's milestones and progress (P3, Spanish).
import { MILESTONE_TITLE_MAX_LENGTH } from "./project-constants";

const milestones = (n: number) => (n === 1 ? "1 hito" : `${n} hitos`);

export const MILESTONES_COPY = {
  section: "Hitos",
  /** Accessible name of the heading: the count on screen is a bare number. */
  sectionName: (n: number) => (n === 0 ? "Hitos" : `Hitos, ${milestones(n)}`),
  listLabel: "Hitos del proyecto",
  empty:
    "Sin hitos. Si el proyecto es grande, divídelo en fases: un hito agrupa tareas y se completa solo cuando terminas todas las suyas.",

  // Add
  addLabel: "Nuevo hito",
  addHelp: "Enter lo agrega y deja el campo listo para otro.",
  add: "Agregar hito",
  added: (title: string) => `Hito «${title}» agregado.`,

  // Row
  /** The phase's state (derived from its tasks: there is no checkbox): said by its icon's name. */
  stateComplete: (title: string) => `Hito completo: ${title}`,
  stateInProgress: (title: string, done: number, total: number) =>
    `Hito en curso: ${title}, ${done} de ${total} tareas hechas`,
  stateEmpty: (title: string) => `Hito sin tareas: ${title}`,
  /** Under the title: how far the phase is. */
  tasksCount: (done: number, total: number) => `${done} de ${total} tareas`,
  noTasks: "Sin tareas",
  edit: (title: string) => `Editar hito ${title}`,
  dueOn: (day: string) => `Para el ${day}`,
  done: "Hecho",

  // Editor
  editForm: "Editar hito",
  titleLabel: "Título",
  titleHelp: `Hasta ${MILESTONE_TITLE_MAX_LENGTH} caracteres.`,
  dueLabel: "Fecha",
  dueHelp: "Opcional.",
  saved: "Se guardó el hito.",
  delete: "Eliminar hito",

  // Order (same pattern as areas, C6)
  moveUp: (title: string) => `Subir ${title}`,
  moveDown: (title: string) => `Bajar ${title}`,
  drag: (title: string) => `Mover ${title}`,
  dragRole: "elemento ordenable",
  dragInstructions:
    "Para mover un hito, pulsa Espacio o Enter, muévelo con las flechas arriba y abajo y vuelve a pulsar Espacio o Enter para dejarlo. Escape cancela. En pantallas táctiles, mantén presionado y arrastra. También puedes usar los botones Subir y Bajar.",
  position: (index: number, total: number) => `lugar ${index + 1} de ${total}`,
  dragStart: (title: string, place: string) => `Tomaste «${title}», en el ${place}.`,
  dragOver: (title: string, place: string) => `«${title}» está en el ${place}.`,
  dragSame: (title: string, place: string) => `«${title}» quedó en el mismo ${place}.`,
  dragCancel: (title: string, place: string) => `Cancelado. «${title}» volvió al ${place}.`,

  // Notices
  orderTitle: "Orden de hitos",
  moved: (title: string, place: string) => `«${title}» pasó al ${place}.`,
  orderRestored: "Volvió el orden anterior de los hitos.",
  deletedTitle: "Hito eliminado",
  deleted: (title: string) => `«${title}» se eliminó.`,
  restored: (title: string) => `«${title}» volvió a su lugar.`,
  /** First part of every rollback notice; the reason follows. */
  notSaved: {
    add: "No se pudo agregar el hito; se quitó de la lista.",
    update: "No se pudo guardar el hito; volvió a como estaba.",
    remove: "No se pudo eliminar el hito; volvió a la lista.",
    reorder: "No se pudo guardar el orden de los hitos; volvió a como estaba.",
  },

  // Progress counts tasks only (hitos-agrupan-tareas): a milestone is a phase that groups them.
  progressLabel: "Avance",
  progressCount: (done: number, total: number) => `${done} de ${total}`,
  progressUnits: "tareas",
  /** Accessible name of the meter (and of the card's progress). */
  progressName: (percent: string, done: number, total: number) =>
    `Avance: ${percent}, ${done} de ${total} tareas`,
} as const;
