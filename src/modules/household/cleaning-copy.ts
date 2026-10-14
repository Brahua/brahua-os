// User-facing copy of the cleaning view (Spanish). No guilt: «Toca», «Desde…», never «atrasada»
// (SPEC-household "Tono"); a test scans every string here.
import type { Frequency } from "./cleaning";

export const WEEKDAY_NAMES = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
] as const;

export const CLEANING_COPY = {
  pageTitle: "Hogar",
  viewsNav: "Secciones del Hogar",
  views: { limpieza: "Limpieza", compras: "Compras", recetas: "Recetas" },
  noticesLabel: "Avisos del Hogar",
  undoHint: "Se puede deshacer",

  groupLabel: "Agrupar",
  groups: { zona: "Por zona", dia: "Por día" },

  add: "Añadir limpieza",
  emptyTitle: "Nada que limpiar por ahora.",
  emptyText: "Añade una limpieza y aparecerá aquí y en Hoy el día que toque.",
  noZone: "Sin zona",
  before: "De antes",
  later: "Más adelante",
  noDate: "Sin fecha",
  dueThisWeek: (count: number) =>
    count === 0
      ? "Nada esta semana"
      : count === 1
        ? "1 toca esta semana"
        : `${count} tocan esta semana`,

  // A row
  frequencies: {
    daily: "Cada día",
    weekly: "Cada semana",
    biweekly: "Cada 2 semanas",
    monthly: "Cada mes",
    quarterly: "Cada 3 meses",
  } satisfies Record<Frequency, string>,
  weeklyOn: (days: string) => `Cada semana, ${days}`,
  dueToday: "toca hoy",
  dueTomorrow: "toca mañana",
  dueOn: (day: string) => `toca el ${day}`,
  since: (day: string) => `desde el ${day}`,
  done: "Hecho",
  doneName: (title: string) => `Hecho: ${title}`,
  remove: "Quitar",
  removeName: (title: string) => `Quitar: ${title}`,
  openTask: (title: string) => `Abrir en Tareas: ${title}`,

  // Notices
  doneTitle: "Limpieza hecha",
  doneNext: (title: string, day: string) => `«${title}» está hecha. La siguiente toca el ${day}.`,
  doneNoNext: (title: string) => `«${title}» está hecha.`,
  undone: (title: string) => `«${title}» volvió a tocar.`,
  removedTitle: "Limpieza quitada",
  removed: (title: string) => `Quitaste «${title}».`,
  restored: (title: string) => `«${title}» volvió.`,
  undo: "Deshacer",
  notSavedTitle: "Sin guardar",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  notFound: "Esa limpieza ya no está.",
  notDone: "No se pudo marcar como hecha.",
  notRemoved: "No se pudo quitar.",
  notUndone: "No se pudo deshacer.",
  added: (title: string) => `Añadiste «${title}».`,

  // The sheet
  sheetTitle: "Añadir limpieza",
  titleLabel: "Qué hay que limpiar",
  titlePlaceholder: "Limpiar inodoro",
  zoneLabel: "Zona",
  zoneHelp: "Elige una o escribe otra.",
  frequencyLabel: "Con qué frecuencia",
  weekdaysLegend: "Qué días",
  firstDateLabel: "Primera vez",
  firstDateHelp: "Si lo dejas vacío, el primer día que toque.",
  submit: "Añadir",
  cancel: "Cancelar",
  weekdayShort: ["L", "M", "X", "J", "V", "S", "D"],
} as const;

export const CLEANING_ERRORS = {
  title: "Escribe qué hay que limpiar.",
  titleTooLong: "Usa 200 caracteres o menos.",
  zoneEmpty: "Elige o escribe una zona.",
  zoneTooLong: "Usa 24 caracteres o menos.",
  zoneComma: "La zona no puede llevar comas.",
  zoneInvisible: "La zona tiene caracteres que no se ven.",
  frequency: "Elige con qué frecuencia.",
  weekdays: "Elige al menos un día.",
  date: "Escribe una fecha válida.",
  dateNotOnWeekday: "La primera fecha debe caer en uno de los días elegidos.",
  past: "La primera vez no puede ser en el pasado.",
} as const;
