// User-facing copy of the projects screens (Spanish).
import {
  PROJECT_NAME_MAX_LENGTH,
  type ProjectPriority,
  type ProjectStatus,
} from "./project-constants";
import type { OpenWork } from "./project-close";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idea",
  active: "Activo",
  paused: "Pausado",
  maintenance: "Mantenimiento",
  done: "Terminado",
  canceled: "Cancelado",
};

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

/** What each in-place edit saves, as it reads in "No se pudo guardar …". */
export const PROJECT_FIELD_NAMES = {
  name: "el nombre",
  status: "el estado",
  priority: "la prioridad",
  area: "el área",
  objective: "el objetivo",
  dates: "las fechas",
} as const;

export type ProjectField = keyof typeof PROJECT_FIELD_NAMES;

export const PROJECTS_COPY = {
  title: "Proyectos",
  newProject: "Nuevo proyecto",

  // Area filter
  filterLabel: "Filtrar por área",
  filterTrigger: "Área:",
  /** Accessible name of the trigger: says what it does and what is on now. */
  filterTriggerName: (area: string) => `Filtrar por área: ${area}`,
  filterOptions: "Áreas",
  allAreas: "Todas",
  allAreasOption: "Todas las áreas",
  archivedArea: "Archivada",
  filterApplied: (area: string | null) =>
    area ? `Mostrando los proyectos de «${area}».` : "Mostrando todas las áreas.",

  // List
  groupList: (status: string) => `Proyectos: ${status}`,
  highPriority: "Prioridad alta",
  highPriorityShort: "Alta",
  emptyTitle: "Aún no tienes proyectos",
  emptyText:
    "Un proyecto es algo con un final: un viaje, una mudanza, una certificación. Crea el primero con nombre, área y estado; lo demás lo completas después.",
  emptyIdleTitle: "Nada en curso",
  emptyIdleText:
    "Tus proyectos están terminados o cancelados (en el Historial, más abajo). Crea uno nuevo cuando quieras.",
  /**
   * Accessible name of a group heading or the Historial toggle: the visible title first, then
   * the count in words (on screen it is a bare number, which says nothing when heard).
   */
  groupName: (title: string, n: number) => `${title}, ${n === 1 ? "1 proyecto" : `${n} proyectos`}`,
  emptyFilteredTitle: (area: string) => `Sin proyectos en «${area}»`,
  emptyFilteredText: "No hay proyectos en curso en esta área.",
  showAll: "Ver todas las áreas",

  // History
  historyTitle: "Historial",
  historyHelp:
    "Los proyectos terminados y cancelados salen de la vista principal pero quedan aquí.",

  // Create sheet
  nameLabel: "Nombre",
  nameHelp: `Hasta ${PROJECT_NAME_MAX_LENGTH} caracteres.`,
  areaLabel: "Área",
  areaHint: "Solo áreas activas.",
  noAreas: "No tienes áreas activas. Crea o desarchiva una en Áreas para poder crear proyectos.",
  statusLabel: "Estado",
  cancel: "Cancelar",
  create: "Crear proyecto",
  creating: "Creando…",
  creatingStatus: "Creando proyecto…",
  created: (name: string) => `Proyecto «${name}» creado.`,
  unexpected: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.",

  // Detail
  backToList: "Volver a Proyectos",
  completedOn: (day: string) => `Terminado el ${day}`,
  editName: "Editar nombre",
  save: "Guardar",
  saving: "Guardando…",
  // Estado y clasificación
  stateSection: "Estado y prioridad",
  statusHelp:
    "Con las flechas recorres los estados y se guarda al detenerte; con un toque, al momento.",
  priorityLabel: "Prioridad",
  areaArchived:
    "Su área actual está archivada: la conserva hasta que elijas otra. Solo áreas activas.",
  areaArchivedShort: "(archivada)",
  changeArea: "Cambiar área",
  /** The pencil's name (and tooltip) says which area it changes. */
  changeAreaOf: (area: string) => `Cambiar área (${area})`,
  areaPickerHint: "Solo áreas activas.",
  noAreasToMove: "No tienes otras áreas activas. Crea o desarchiva una en Áreas para moverlo.",
  // Objetivo y fechas
  planSection: "Objetivo y fechas",
  objectiveLabel: "Objetivo",
  objectiveHelp: "Cómo sabrás que terminó. Hasta 280 caracteres; vacío lo quita.",
  objectiveEmpty: "Sin objetivo.",
  editObjective: "Editar objetivo",
  datesLabel: "Fechas",
  startLabel: "Inicio",
  dueLabel: "Fin",
  dateHelp: "Opcional.",
  datesEmpty: "Sin fechas.",
  dueHiddenInMaintenance: "En Mantenimiento no hay fecha de fin.",
  /** Maintenance hides the end date, but a saved one still bounds the start. */
  startAfterHiddenDue: (due: string) =>
    `El inicio no puede ser posterior a la fecha de fin guardada (${due}).`,
  editDates: "Editar fechas",
  // Avisos
  noticesLabel: "Avisos",
  undoHint: "Para deshacer, pulsa Ctrl+Z o ⌘Z, o usa el botón Deshacer del aviso.",
  undo: "Deshacer",
  notSavedTitle: "Sin guardar",
  /** First part of every rollback notice; the reason follows. */
  notSaved: (what: string) => `No se pudo guardar ${what}; volvió a como estaba.`,
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  saved: (what: string) => `Se guardó ${what}.`,
  // Eliminar
  delete: "Eliminar proyecto",
  deleteConfirmTitle: (name: string) => `¿Eliminar «${name}»?`,
  deleteConfirmText:
    "Sale de todas tus listas y podrás deshacerlo desde el aviso. Si no lo vas a hacer, mejor márcalo como Cancelado.",
  deleteConfirm: "Sí, eliminar",
  deleting: "Eliminando…",
  deletedTitle: "Proyecto eliminado",
  deleted: (name: string) => `«${name}» se eliminó.`,
  undoneTitle: "Deshecho",
  restored: (name: string) => `«${name}» volvió a tus proyectos.`,
  undoFailed: "No se pudo deshacer. Inténtalo de nuevo.",
  notFoundTitle: "Proyecto no encontrado · brahua-os",
  notFoundLcd: "No encontramos este proyecto.",
  notFoundHeading: "Este proyecto no está",
  notFoundText:
    "Puede que se haya eliminado o que el enlace esté incompleto. Tus demás proyectos siguen en su lugar.",
} as const;

/** "Bloqueado por" (P4): the detail's section, its header line and the list's badge. */
export const DEPENDENCIES_COPY = {
  blocked: "Bloqueado",
  /** The card's description and the header's line: who it waits for. */
  blockedBy: (names: readonly string[]) => `Bloqueado por ${names.join(", ")}`,
  blockedByPrefix: "Bloqueado por",
  section: "Bloqueado por",
  sectionHelp:
    "Proyectos que deben terminar antes de este. Al terminarse o cancelarse, dejan de bloquearlo.",
  empty: "No espera a ningún otro proyecto.",
  blockerList: "Proyectos que lo bloquean",
  /** A blocker done or canceled stays listed, but no longer blocks. */
  notBlocking: "Ya no bloquea",
  add: "Agregar bloqueador",
  remove: (name: string) => `Quitar «${name}»`,
  // Sheet
  sheetTitle: "Agregar bloqueador",
  sheetDescription:
    "Elige el proyecto que debe terminar antes. No aparecen los que crearían un ciclo, aunque la cadena pase por un proyecto eliminado (podría volver con «Deshacer»).",
  searchLabel: "Buscar proyecto",
  results: "Proyectos",
  resultCount: (n: number) =>
    n === 0 ? "Ningún proyecto" : n === 1 ? "1 proyecto" : `${n} proyectos`,
  noMatches: "Ningún proyecto coincide con la búsqueda.",
  noCandidates: "No hay otros proyectos que puedan bloquearlo.",
  adding: "Agregando…",
  // Notices
  addedAnnounce: (name: string) => `«${name}» ahora bloquea este proyecto.`,
  removedTitle: "Bloqueador quitado",
  removed: (name: string) => `«${name}» ya no bloquea este proyecto.`,
  restoredTitle: "Deshecho",
  restored: (name: string) => `«${name}» vuelve a bloquear este proyecto.`,
  notRemoved: (name: string) => `No se pudo quitar «${name}»; volvió a como estaba.`,
  notRestored: (name: string) => `No se pudo volver a agregar «${name}».`,
} as const;

/** "N hitos abiertos y M tareas abiertas" (singular or plural each), or null with nothing open. */
function openWorkList({ milestones, tasks }: OpenWork): { list: string; many: boolean } | null {
  const parts: string[] = [];
  if (milestones > 0) {
    parts.push(milestones === 1 ? "1 hito abierto" : `${milestones} hitos abiertos`);
  }
  if (tasks > 0) parts.push(tasks === 1 ? "1 tarea abierta" : `${tasks} tareas abiertas`);
  if (parts.length === 0) return null;
  return { list: parts.join(" y "), many: parts.length > 1 || milestones + tasks > 1 };
}

/** "Cerrar proyecto" (Checkpoint final): mark as done or cancel, with a confirm step; reopen. */
export const CLOSE_COPY = {
  section: "Cerrar proyecto",
  help: "Terminado y Cancelado salen de la vista principal y quedan en el Historial. Puedes reabrirlo cuando quieras.",
  markDone: "Marcar como terminado",
  cancelProject: "Cancelar proyecto",
  /** Dismisses a confirm step ("Cancelar" next to "Cancelar proyecto" would be ambiguous). */
  back: "Volver",
  doneTitle: (name: string) => `¿Marcar «${name}» como terminado?`,
  doneText: "Sale de la vista principal y queda en el Historial con la fecha de hoy.",
  /** The warning of the done confirm step, or null when nothing is open. */
  openWorkWarning: (open: OpenWork): string | null => {
    const work = openWorkList(open);
    if (!work) return null;
    return `${work.many ? "Quedan" : "Queda"} ${work.list}. ¿Terminar igual?`;
  },
  doneConfirm: "Sí, terminar",
  finishing: "Terminando…",
  cancelTitle: (name: string) => `¿Cancelar «${name}»?`,
  cancelText:
    "Sale de la vista principal y queda en el Historial. Sus hitos, notas y enlaces se conservan.",
  cancelConfirm: "Sí, cancelar proyecto",
  canceling: "Cancelando…",
  /** The block of a closed project. */
  doneState: (day: string) => `Se terminó el ${day}.`,
  canceledState: "Se canceló.",
  closedHelp: "Está en el Historial. Al reabrirlo vuelve a Activo y a la vista principal.",
  reopen: "Reabrir",
  reopenTitle: (name: string) => `¿Reabrir «${name}»?`,
  reopenText: "Vuelve a Activo y a la vista principal. Luego puedes cambiarle el estado.",
  reopenDoneText:
    "Vuelve a Activo y a la vista principal, y se borra la fecha de término. Luego puedes cambiarle el estado.",
  reopenConfirm: "Sí, reabrir",
  reopening: "Reabriendo…",
  /** Announced once it is done: the server's own count of what was left open, if anything. */
  done: (name: string, open: OpenWork) => {
    const work = openWorkList(open);
    const left = work ? ` ${work.many ? "Quedaron" : "Quedó"} ${work.list}.` : "";
    return `«${name}» se marcó como terminado.${left}`;
  },
  canceled: (name: string) => `«${name}» se canceló.`,
  reopened: (name: string) => `«${name}» se reabrió como Activo.`,
  /** The state picker of a closed project gives way to this line. */
  closedStatus: (state: string) =>
    `${state}. Para cambiar el estado, reábrelo en «Cerrar proyecto», más abajo.`,
} as const;
