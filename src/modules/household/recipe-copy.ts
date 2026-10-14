// User-facing copy of the recipes (Spanish). No guilt; a test scans every string here
// (tests/modules/household-copy.test.ts).
import { MEAL_TYPES, type MealType } from "./recipe-constants";

export const MEAL_LABELS = {
  breakfast: "Desayuno",
  midmorning: "Media mañana",
  lunch: "Almuerzo",
  afternoon: "Media tarde",
  snack: "Merienda",
  dinner: "Cena",
} satisfies Record<MealType, string>;

/** The weekdays, Monday first (ISO 1–7). */
export const WEEKDAY_LABELS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;
export const WEEKDAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"] as const;
export const WEEKDAY_ABBR = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

export const RECIPE_ERRORS = {
  name: "Escribe el nombre de la receta.",
  nameTooLong: "Usa 120 caracteres o menos.",
  invisible: "Tiene caracteres que no se ven.",
  url: "Escribe un enlace que empiece por http:// o https://",
  meals: "Elige tipos de comida válidos.",
  weekdays: "Elige días válidos.",
  notFound: "Esa receta ya no está.",
} as const;

export const RECIPE_COPY = {
  noticesLabel: "Avisos de recetas",
  undoHint: "Se puede deshacer",

  add: "Añadir receta",
  emptyTitle: "Aún no hay recetas.",
  emptyText: "Añade una con su enlace y la tendrás a mano el día que toque.",
  noMatchTitle: "Ninguna receta con ese filtro.",
  noMatchText: "Quita un filtro para ver más.",
  forToday: (weekday: string) => `Para hoy · ${weekday}`,
  nothingToday: "No tienes recetas sugeridas para hoy.",
  all: "Todas las recetas",
  count: (count: number) => (count === 1 ? "1 receta" : `${count} recetas`),

  // Filters
  filtersLabel: "Filtrar recetas",
  mealFilter: "Tipo de comida",
  dayFilter: "Día",
  clearFilters: "Quitar filtros",
  filterName: (label: string) => `Filtrar por ${label}`,

  // A row
  opensNewTab: "se abre en otra pestaña",
  noLink: "Sin enlace",
  edit: "Editar",
  editName: (name: string) => `Editar: ${name}`,
  remove: "Quitar",
  removeName: (name: string) => `Quitar: ${name}`,
  removedTitle: "Receta quitada",
  removed: (name: string) => `Quitaste «${name}».`,
  restored: (name: string) => `«${name}» volvió.`,
  undo: "Deshacer",

  // The sheet
  sheetAddTitle: "Añadir receta",
  sheetEditTitle: "Editar receta",
  nameLabel: "Nombre",
  namePlaceholder: "Arroz con pollo",
  mealsLegend: "Tipo de comida",
  daysLegend: "Días sugeridos",
  urlLabel: "Enlace",
  urlHelp: "Opcional. Debe empezar por http:// o https://",
  save: "Guardar",
  cancel: "Cancelar",
  added: (name: string) => `Añadiste «${name}».`,
  saved: (name: string) => `Guardaste «${name}».`,

  // Failures
  notSavedTitle: "Sin guardar",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  notRemoved: "No se pudo quitar.",
  notUndone: "No se pudo deshacer.",
} as const;

/** The meals as the sheet and the filter offer them, in the order of the day. */
export const MEAL_OPTIONS = MEAL_TYPES.map((value) => ({ value, label: MEAL_LABELS[value] }));
