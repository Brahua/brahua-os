// User-facing copy of a project's milestones and progress (P3, Spanish).
import { MILESTONE_TITLE_MAX_LENGTH } from "./project-constants";

const milestones = (n: number) => (n === 1 ? "1 hito" : `${n} hitos`);

export const MILESTONES_COPY = {
  section: "Hitos",
  /** Accessible name of the heading: the count on screen is a bare number. */
  sectionName: (n: number) => (n === 0 ? "Hitos" : `Hitos, ${milestones(n)}`),
  listLabel: "Hitos del proyecto",
  empty:
    "Sin hitos. Si el proyecto es grande, divídelo en hitos: el avance sale de los que marques.",

  // Add
  addLabel: "Nuevo hito",
  addHelp: "Enter lo agrega y deja el campo listo para otro.",
  add: "Agregar hito",
  added: (title: string) => `Hito «${title}» agregado.`,

  // Row
  checkbox: (title: string) => `Hecho: ${title}`,
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
    done: "No se pudo marcar el hito; volvió a como estaba.",
    remove: "No se pudo eliminar el hito; volvió a la lista.",
    reorder: "No se pudo guardar el orden de los hitos; volvió a como estaba.",
  },

  // Progress
  progressLabel: "Avance",
  progressCount: (done: number, total: number) => `${done} de ${milestones(total)}`,
  /** Accessible name of the meter (and of the card's progress). */
  progressName: (percent: string, done: number, total: number) =>
    `Avance: ${percent}, ${done} de ${milestones(total)}`,
} as const;
