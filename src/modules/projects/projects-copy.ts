// User-facing copy of the projects screens (Spanish).
import {
  PROJECT_NAME_MAX_LENGTH,
  type ProjectPriority,
  type ProjectStatus,
} from "./project-constants";

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

export const PROJECTS_COPY = {
  title: "Proyectos",
  newProject: "Nuevo proyecto",

  // Area filter
  filterLabel: "Filtrar por área",
  allAreas: "Todas",

  // List
  groupList: (status: string) => `Proyectos: ${status}`,
  highPriority: "Prioridad alta",
  highPriorityShort: "Alta",
  emptyTitle: "Aún no tienes proyectos",
  emptyText:
    "Un proyecto es algo con un final: un viaje, una mudanza, una certificación. Crea el primero con nombre, área y estado; lo demás lo completas después.",
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
  unexpected: "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.",

  // Detail (P1: minimal; P2 builds the real one)
  backToList: "Volver a Proyectos",
  statusMeta: "Estado",
  areaMeta: "Área",
  priorityMeta: "Prioridad",
  detailComingSoon:
    "Pronto podrás editar el proyecto, sus fechas, hitos, enlaces y notas desde aquí.",
  notFoundTitle: "Proyecto no encontrado · brahua-os",
  notFoundLcd: "No encontramos este proyecto.",
  notFoundHeading: "Este proyecto no está",
  notFoundText:
    "Puede que se haya eliminado o que el enlace esté incompleto. Tus demás proyectos siguen en su lugar.",
} as const;
