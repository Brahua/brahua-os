// User-facing copy of the tasks screens (Spanish).
import { TASK_TITLE_MAX_LENGTH, type TaskPriority } from "./task-constants";
import type { TaskView } from "./routes";

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  bandeja: "Bandeja",
  hoy: "Hoy",
  proximas: "Próximas",
  todas: "Todas",
  hechas: "Hechas",
};

/** What each in-place edit saves, as it reads in "No se pudo guardar …". */
export const TASK_FIELD_NAMES = {
  title: "el título",
  placement: "el área o proyecto",
  dueDate: "la fecha",
  priority: "la prioridad",
} as const;

export type TaskField = keyof typeof TASK_FIELD_NAMES;

export const TASKS_COPY = {
  title: "Tareas",
  viewsLabel: "Vistas de tareas",
  noticesLabel: "Avisos",
  undoHint: "Para deshacer, pulsa Ctrl+Z o ⌘Z, o usa el botón Deshacer del aviso.",
  undo: "Deshacer",

  // Quick capture
  captureTitle: "Nueva tarea",
  captureTitleLabel: "¿Qué hay que hacer?",
  captureTitleHelp: "Enter guarda. Sin área ni proyecto, va a la bandeja.",
  add: "Agregar",
  adding: "Agregando…",
  addingStatus: "Agregando tarea…",
  close: "Cerrar",
  addedToInbox: "Tarea agregada a la bandeja.",
  addedTo: (where: string) => `Tarea agregada a «${where}».`,
  moreDetails: "Más detalles",

  // Placement and dates
  placementLabel: "Área o proyecto",
  placementInbox: "Bandeja (sin clasificar)",
  placementAreas: "Áreas",
  placementProjects: "Proyectos",
  placementProject: (project: string, area: string) => `${project} · ${area}`,
  placementArchived: (name: string) => `${name} (archivada)`,
  placementClosed: (name: string) => `${name} (cerrado)`,
  placementLoading: "Cargando áreas y proyectos…",
  placementLoadFailed:
    "No se pudieron cargar las áreas y proyectos. Puedes guardarla en la bandeja y clasificarla después.",
  dueLabel: "Fecha límite",
  dueHelp: "Opcional.",
  noDate: "Sin fecha",
  priorityLabel: "Prioridad",
  highPriority: "Prioridad alta",
  highPriorityShort: "Alta",

  // Slots for the parallel tasks (no UI until they land)
  // T3: recurrenceLabel, T4: tagsLabel.

  // Inbox
  inboxTitle: "Bandeja",
  inboxList: "Tareas en la bandeja",
  inboxHelp:
    "Lo que capturas sin área ni proyecto llega aquí. Clasifícalo, ponle fecha o márcalo hecho.",
  emptyInboxTitle: "Bandeja vacía",
  emptyInboxText:
    "Todo está clasificado. Para anotar algo nuevo, usa la tecla naranja de captura.",
  /** Only with the shortcuts on, and only where they act (≥ 1024 px). */
  emptyInboxShortcut: " También puedes pulsar C.",
  viewTitle: (view: string) => `${view} · Tareas · brahua-os`,
  complete: (title: string) => `Hecha: ${title}`,
  completedTitle: "Tarea hecha",
  completed: (title: string) => `«${title}» está hecha.`,
  reopened: (title: string) => `«${title}» volvió a estar pendiente.`,
  classify: (title: string) => `Clasificar «${title}»`,
  classifyShort: "Clasificar",
  classifyTitle: "Clasificar tarea",
  classifyDescription: (title: string) => `«${title}»: elige dónde va y, si hace falta, una fecha.`,
  save: "Guardar",
  saving: "Guardando…",
  cancel: "Cancelar",
  movedTitle: "Tarea clasificada",
  movedTo: (title: string, where: string) => `«${title}» pasó a «${where}».`,
  dueSet: (title: string) => `Se guardó la fecha de «${title}».`,
  movedBack: (title: string) => `«${title}» volvió a la bandeja.`,

  // Detail
  backToList: "Volver a Tareas",
  open: (title: string) => `Abrir «${title}»`,
  detailTitle: "Tarea",
  planTitle: "Dónde y cuándo",
  titleLabel: "Título",
  titleHelp: `Hasta ${TASK_TITLE_MAX_LENGTH} caracteres.`,
  editTitle: "Editar título",
  doneOn: (day: string) => `Hecha el ${day}.`,
  notFoundTitle: "Tarea no encontrada · brahua-os",
  notFoundLcd: "No encontramos esta tarea.",
  notFoundHeading: "Esta tarea no existe",
  notFoundText: "Puede que se haya eliminado. Las demás siguen en Tareas.",
  saved: (what: string) => `Se guardó ${what}.`,

  // Delete
  deleteTask: "Eliminar tarea",
  deleteHelp: "Sale de todas las vistas; puedes deshacerlo desde el aviso.",
  deleting: "Eliminando…",
  deletedTitle: "Tarea eliminada",
  deleted: (title: string) => `«${title}» se eliminó.`,
  restored: (title: string) => `«${title}» volvió a tus tareas.`,

  // Failures
  notSavedTitle: "Sin guardar",
  notSaved: (what: string) => `No se pudo guardar ${what}; volvió a como estaba.`,
  notCompleted: "No se pudo marcar la tarea; volvió a como estaba.",
  notDeleted: "No se pudo eliminar la tarea; volvió a como estaba.",
  notUndone: "No se pudo deshacer.",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  unexpected: "No se pudo guardar. Inténtalo de nuevo en un momento.",
} as const;
