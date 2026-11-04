// Copy of `notes` (SPEC-notes "Pantallas"), in Spanish. Client-safe. No guilt (SPEC-notes "Tono"):
// never «atrasado», «fallaste» or «deuda»; tests/modules/notes-copy.test.ts scans every string of
// the module's `*copy.ts` files.
import {
  NOTE_BODY_MAX_LENGTH,
  NOTE_CAPTURE_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
} from "./note-constants";

const formatCount = (n: number) => n.toLocaleString("es");

export const NOTES_ERRORS = {
  titleRequired: "Ponle un título.",
  titleTooLong: `Usa ${NOTE_TITLE_MAX_LENGTH} caracteres como máximo.`,
  invisible: "Quita los caracteres invisibles o de control del título.",
  body: {
    tooLong: `Usa ${formatCount(NOTE_BODY_MAX_LENGTH)} caracteres como máximo.`,
    control:
      "Quita los caracteres de control del texto (solo se permiten saltos de línea y tabulaciones).",
    bidi: "Quita los caracteres invisibles que cambian el sentido del texto (marcas bidireccionales).",
    placeholder: "Quita los caracteres invisibles de uso privado del texto.",
  },
  day: "Elige hoy o un día anterior.",
  version: "La petición no es válida. Recarga la página e inténtalo de nuevo.",
  area: "Elige un área de la lista.",
  areaUnavailable: "Esa área ya no está disponible. Elige otra o ninguna.",
  notFound: "Esta nota ya no existe (se eliminó).",
  dayTaken: "Ya hay otra nota de ese día: ábrela desde la lista.",

  // N3: a line turned into a task, and the quick capture.
  changed:
    "Cambió mientras tanto: la nota ya no es la que se veía. Revísala y vuelve a intentarlo.",
  lineTooLong:
    "Esa línea es más larga que el título de una tarea (200 caracteres). Acórtala y vuelve a intentarlo.",
  lineInvisible: "Quita los caracteres invisibles o de control de esa línea.",
  lineEmpty: "Esa línea no tiene texto para la tarea.",
  bodyFull: `La nota llegó a su límite de ${formatCount(NOTE_BODY_MAX_LENGTH)} caracteres: no cabe más texto.`,
  taskChanged: "La tarea ya cambió (se editó o se marcó), así que se queda como está.",
  captureEmpty: "Escribe algo para añadir.",
  captureTooLong: `Usa ${formatCount(NOTE_CAPTURE_MAX_LENGTH)} caracteres como máximo.`,
  captureInvisible: "Quita los caracteres invisibles o de control del texto.",
} as const;

export type NoteFailure =
  | "notFound"
  | "areaUnavailable"
  | "dayTaken"
  | "changed"
  | "lineTooLong"
  | "lineInvisible"
  | "lineEmpty"
  | "bodyFull"
  | "taskChanged";

export const NOTES_COPY = {
  pageTitle: "Notas",
  heading: "Notas",
  noticesLabel: "Avisos de Notas",
  undoHint: "Para deshacer, usa el botón Deshacer del aviso.",
  newDay: "Empezó un día nuevo.",

  // The list (/notes).
  todayNote: "Nota de hoy",
  continueTodayNote: "Seguir la nota de hoy",
  newNote: "Nueva nota",
  kindFilterLabel: "Qué notas ver",
  kindAll: "Todas",
  kindDaily: "Diario",
  kindPage: "Notas",
  areaFilterLabel: "Área",
  allAreas: "Todas las áreas",
  listLabel: "Notas",
  emptyTitle: "Escribe lo que pasó hoy",
  emptyText: "Una nota por día para lo que pasa, y notas con título para lo que aprendes.",
  emptyFiltered: "No hay notas con estos filtros.",
  clearFilters: "Quitar filtros",
  showMore: "Ver más",
  noteCount: (count: number, more: boolean) =>
    more ? `Más de ${count} notas` : count === 1 ? "1 nota" : `${count} notas`,
  pinned: "Fijada",
  noText: "Sin texto todavía",
  editedToday: "Hoy",
  editedYesterday: "Ayer",
  editedDaysAgo: (days: number) => `Hace ${days} días`,

  // The search (N4).
  searchLabel: "Buscar en notas",
  searchSubmit: "Buscar",
  searchClear: "Limpiar búsqueda",
  searchResultsLabel: "Resultados de la búsqueda",
  searchTooShort: "Escribe al menos 2 letras o números para buscar.",
  searchNoResults: (text: string) => `Sin resultados para «${text}».`,
  searchNoResultsFiltered: (text: string) => `Sin resultados para «${text}» con estos filtros.`,
  searchResultCount: (count: number, more: boolean) =>
    more ? `Más de ${count} resultados` : count === 1 ? "1 resultado" : `${count} resultados`,

  // «Nueva nota».
  newNoteTitle: "Nueva nota",
  newNoteText: "Ponle un título; el texto lo escribes en la nota.",
  titleLabel: "Título",
  areaLabel: "Área",
  areaHelp: "Opcional.",
  noArea: "Sin área",
  archivedArea: (name: string) => `${name} (archivada)`,
  create: "Crear nota",
  creating: "Creando…",
  cancel: "Cancelar",

  // A note's page.
  backToList: "Notas",
  goToList: "Ir a Notas",
  previousDay: "Día anterior",
  nextDay: "Día siguiente",
  dayNavLabel: "Otros días",
  goToDayLabel: "Ir a un día",
  go: "Ir",
  actionsLabel: "Acciones de la nota",
  edit: "Editar",
  done: "Listo",
  editorLabel: "Editar la nota",
  bodyLabel: "Texto de la nota",
  bodyHelp: "Markdown. Se guarda automáticamente.",
  counter: (used: number, max: number) => `${formatCount(used)} de ${formatCount(max)} caracteres.`,
  overLimit: (used: number, max: number) =>
    `${formatCount(used)} de ${formatCount(max)} caracteres: quita ${formatCount(used - max)} para guardar.`,
  emptyBody: "Usa «Editar» o toca el texto para escribir.",
  previewLoading: "Cargando…",

  // The autosave indicator.
  saving: "Guardando…",
  saved: "Guardado",
  unsaved: (reason: string) => `Sin guardar: ${reason}`,
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  retry: "Reintentar",

  // Two devices.
  conflictTitle: "Cambió en otro dispositivo",
  conflictText:
    "Esta nota se guardó en otro lado mientras escribías. Tu texto sigue aquí, sin guardar.",
  viewSaved: "Ver la versión guardada",
  keepMine: "Quedarme con la mía",
  draftTitle: "Tu borrador",
  draftText: "Lo que habías escrito no se guardó. Copia lo que quieras conservar.",
  draftLabel: "Tu borrador sin guardar",
  discardDraft: "Descartar borrador",

  // Leaving with unsaved changes.
  leaveTitle: "Hay cambios sin guardar",
  leaveText: "Lo último que escribiste todavía no se guardó.",
  stay: "Seguir editando",
  leave: "Salir sin guardar",

  // A knowledge note's header.
  rename: "Cambiar título",
  renameSave: "Guardar título",
  renameCancel: "Cancelar",
  pin: "Fijar",
  unpin: "Quitar de fijadas",
  pinnedText: (title: string) => `«${title}» queda arriba en la lista.`,
  unpinnedText: (title: string) => `«${title}» vuelve a su lugar en la lista.`,
  areaChanged: (title: string) => `«${title}» cambió de área.`,
  renamed: (title: string) => `Ahora se llama «${title}».`,

  // Deleting.
  delete: "Eliminar",
  deletedTitle: "Nota eliminada",
  deleted: (name: string) => `Se eliminó «${name}».`,
  undo: "Deshacer",
  undoneTitle: "Deshecho",
  restored: (name: string) => `Volvió «${name}».`,
  notUndone: "No se pudo deshacer.",

  // Failures.
  notSavedTitle: "Sin guardar",
  notSaved: {
    create: "No se creó la nota.",
    rename: "No se cambió el título.",
    area: "No se cambió el área.",
    pin: "No se cambió «Fijar».",
    delete: "No se eliminó la nota.",
  },

  // `[[` links (N2): the picker's groups, hints and states.
  linkTypeLabels: {
    note: "Notas",
    project: "Proyectos",
    task: "Tareas",
    habit: "Hábitos",
    goal: "Metas",
    learning: "Frentes",
  },
  /** Each option's type, said by screen readers after its name. */
  linkTypeNames: {
    note: "Nota",
    project: "Proyecto",
    task: "Tarea",
    habit: "Hábito",
    goal: "Meta",
    learning: "Frente",
  },
  linkDailyHint: "Diario",
  linkPickerLabel: "Enlazar con",
  linkSearching: "Buscando…",
  linkNoMatches: "Sin coincidencias",
  linkSearchFailed: "No se pudo buscar. Sigue escribiendo para intentarlo de nuevo.",
  linkResults: (count: number) =>
    count === 1
      ? "1 resultado. Elige uno de la lista."
      : `${count} resultados. Elige uno de la lista.`,
  linkInserted: (name: string) => `Enlace a «${name}».`,
  bodyHelpLinks:
    "Escribe [[ para enlazar una nota, un proyecto, una tarea, un hábito, una meta o un frente.",

  // Backlinks (N2).
  linkedFromTitle: "Enlazada desde",
  mentionedInTitle: (count: number) =>
    count === 1 ? "Aparece en 1 nota" : `Aparece en ${count} notas`,

  // N3: a line turned into a task.
  convert: "Convertir en tarea",
  /** The key's accessible name: its visible text first (WCAG 2.5.3), then the line. */
  convertLabel: (text: string) => `Convertir en tarea: ${text}`,
  convertedTitle: "Tarea creada",
  converted: (title: string) => `«${title}» quedó en la bandeja.`,
  convertUndone: (title: string) => `«${title}» volvió a ser una línea de la nota.`,
  notConverted: "No se convirtió en tarea.",
  // The live checkbox of a `[[task:…]]` item.
  taskDoneLabel: (name: string) => `Hecha: ${name}`,
  taskDoneTitle: "Tarea hecha",
  notToggled: "No se cambió la tarea.",

  // N3: the quick capture «Nota» (its switch label, «Nota», is written in capture-provider.tsx).
  captureTitle: "Nota de hoy",
  captureTextLabel: "¿Qué quieres anotar?",
  captureTextHelp: "Se añade al final de la nota de hoy, con la hora.",
  captureAdd: "Añadir a la nota de hoy",
  captureAdding: "Añadiendo…",
  captureAddingStatus: "Añadiendo a la nota de hoy…",
  captureClose: "Cerrar",
  /** What was added, cut at 60 characters with «…». */
  captured: (text: string) =>
    `Se añadió «${text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text}» a la nota de hoy.`,
  captureUndone: "Se quitó de la nota de hoy.",

  // N3: «Ese día», the daily note's footer.
  dayFooterTitle: "Ese día",
  dayFooterTasks: (count: number) => (count === 1 ? "1 tarea hecha" : `${count} tareas hechas`),
  dayFooterHabits: (count: number) =>
    count === 1 ? "1 hábito cumplido" : `${count} hábitos cumplidos`,
  dayFooterEmpty: "Sin registros ese día",

  // Not found.
  notFoundTitle: "Nota no encontrada · brahua-os",
  notFoundLcd: "SIN NOTA",
  notFoundHeading: "Esta nota no existe",
  notFoundText:
    "Puede que se haya eliminado, que el enlace esté mal o que sea un día que todavía no llega.",
} as const;

/** «Nota de hoy» or, when today's note has text, «Seguir la nota de hoy». */
export function todayNoteLabel(hasText: boolean): string {
  return hasText ? NOTES_COPY.continueTodayNote : NOTES_COPY.todayNote;
}

/**
 * «Ese día»'s line (SPEC-notes "Pie"): «4 tareas hechas · 3 hábitos cumplidos», leaving out a part
 * at 0, and «Sin registros ese día» when both are. Never what was missing.
 */
export function dayFooterText(tasksDone: number, habitsDone: number): string {
  const parts = [
    tasksDone > 0 ? NOTES_COPY.dayFooterTasks(tasksDone) : null,
    habitsDone > 0 ? NOTES_COPY.dayFooterHabits(habitsDone) : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : NOTES_COPY.dayFooterEmpty;
}
