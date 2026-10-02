// User-facing copy of the views of /tasks and the detail additions of T2 (Spanish). Apart from
// tasks-copy.ts so T2–T4, built in parallel, never edit the same block.

const count = (n: number) => n.toLocaleString("es");

export const VIEWS_COPY = {
  /** Read after the view's name in its heading: "Hoy: 3 tareas". */
  countHidden: (n: number) => `: ${n === 1 ? "1 tarea" : `${count(n)} tareas`}`,

  // Hoy
  todayList: "Tareas de hoy",
  todayHelp: "Lo retrasado y lo que vence hoy, de lo más antiguo a lo más nuevo.",
  todayEmptyTitle: "Nada para hoy",
  todayEmptyText: "No hay tareas retrasadas ni que venzan hoy. Mira «Próximas» para adelantarte.",

  // Próximas
  upcomingList: "Tareas próximas, por día",
  upcomingHelp: "Lo que vence en los próximos 7 días, sin contar hoy.",
  upcomingEmptyTitle: "Semana despejada",
  upcomingEmptyText: "Nada vence en los próximos 7 días.",

  // Todas
  allList: "Tareas pendientes",
  allHelp: "Todo lo pendiente, por fecha, prioridad y antigüedad. Lo que no tiene fecha va al final.",
  allEmptyTitle: "Sin tareas pendientes",
  allEmptyText: "No queda nada por hacer. Para anotar algo, usa la tecla naranja de captura.",
  filteredEmptyTitle: "Nada con estos filtros",
  filteredEmptyText: "No hay tareas pendientes que cumplan los filtros elegidos.",
  clearFilters: "Quitar filtros",
  filtersLabel: "Filtros",
  areaFilterTitle: "Filtrar por área",
  areaFilterTrigger: "Área:",
  areaFilterName: (area: string) => `Filtrar por área: ${area}`,
  areaFilterOptions: "Áreas",
  allAreas: "Todas",
  allAreasOption: "Todas las áreas",
  archivedArea: "Archivada",
  projectFilterTitle: "Filtrar por proyecto",
  projectFilterTrigger: "Proyecto:",
  projectFilterName: (project: string) => `Filtrar por proyecto: ${project}`,
  projectFilterOptions: "Proyectos",
  allProjects: "Todos",
  allProjectsOption: "Todos los proyectos",
  noProjects: "Ningún proyecto tiene tareas pendientes.",
  noProjectsInArea: (area: string) => `Ningún proyecto de «${area}» tiene tareas pendientes.`,
  filterApplied: (what: string) => `Filtro aplicado: ${what}.`,
  filterCleared: "Sin filtro.",

  // Hechas
  doneList: "Tareas hechas",
  doneHelp: "Lo que completaste en los últimos 30 días, lo más reciente primero.",
  doneEmptyTitle: "Nada hecho todavía",
  doneEmptyText: "Lo que marques como hecho en los últimos 30 días aparece aquí.",
  reopen: "Deshacer",
  reopenName: (title: string) => `Deshacer «${title}» (vuelve a pendientes)`,
  reopenedTitle: "Tarea pendiente",
  completedAgain: (title: string) => `«${title}» volvió a estar hecha.`,

  // Detail: milestone
  milestoneLabel: "Hito",
  noMilestone: "Sin hito",
  milestoneDone: (title: string) => `${title} (hecho)`,
  milestoneHelp: "Opcional. Los hitos de este proyecto.",
  milestoneNone: "Este proyecto no tiene hitos.",
  milestoneLoading: "Cargando los hitos…",
  milestoneLoadingOption: "Cargando…",
  milestoneCurrentOption: "El hito actual",
  milestoneLoadFailed: "No se pudieron cargar los hitos. Inténtalo de nuevo en un momento.",
  milestoneSaved: "Se guardó el hito.",
  milestoneCleared: "La tarea quedó sin hito.",
  milestoneNotSaved: "No se pudo guardar el hito; volvió a como estaba.",

  // Detail: notes
  notesSection: "Notas",
  notesEmpty: "Sin notas. Aquí caben detalles, enlaces y lo que haga falta para hacerla.",
  notesLoading: "Cargando las notas…",
  notesLoadFailed: "No se pudieron cargar las notas. Cierra y vuelve a abrir la tarea.",
  notesWrite: "Escribir notas",
  notesEdit: "Editar notas",
  notesSaved: "Se guardaron las notas.",
  notesSavedEmpty: "Se quitaron las notas.",
  notesNotSaved: "No se pudieron guardar las notas; volvieron a como estaban.",
  notesDraftKept: "Tu texto sigue en «Editar notas».",
  notesDraftPending: "Tienes un borrador sin guardar de estas notas.",
} as const;
