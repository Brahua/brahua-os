// Copy of `notes` (SPEC-notes "Pantallas"), in Spanish. Client-safe. No guilt (SPEC-notes "Tono"):
// never «atrasado», «fallaste» or «deuda»; tests/modules/notes-copy.test.ts scans every string of
// the module's `*copy.ts` files.
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "./note-constants";

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
  },
  day: "Elige hoy o un día anterior.",
  version: "La petición no es válida. Recarga la página e inténtalo de nuevo.",
  area: "Elige un área de la lista.",
  areaUnavailable: "Esa área ya no está disponible. Elige otra o ninguna.",
  notFound: "Esta nota ya no existe (se eliminó).",
  dayTaken: "Ya hay otra nota de ese día: ábrela desde la lista.",
} as const;

export type NoteFailure = "notFound" | "areaUnavailable" | "dayTaken";

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
    learning: "Aprendizaje",
  },
  linkDailyHint: "Diario",
  linkPickerLabel: "Enlazar con",
  linkSearching: "Buscando…",
  linkNoMatches: "Sin coincidencias",
  linkSearchFailed: "No se pudo buscar. Sigue escribiendo para intentarlo de nuevo.",
  linkResults: (count: number) =>
    count === 1 ? "1 resultado. Flechas para elegir." : `${count} resultados. Flechas para elegir.`,
  linkInserted: (name: string) => `Enlace a «${name}».`,
  bodyHelpLinks:
    "Escribe [[ para enlazar una nota, un proyecto, una tarea, un hábito, una meta o un frente.",

  // Backlinks (N2).
  linkedFromTitle: "Enlazada desde",
  mentionedInTitle: (count: number) =>
    count === 1 ? "Mencionado en 1 nota" : `Mencionado en ${count} notas`,

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
