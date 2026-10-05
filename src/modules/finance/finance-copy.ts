// User-facing copy of `finance` (Spanish). Never guilt: no "atrasado", no red, no "gastaste más"
// (docs/principios-ux.md, "Lo que no haremos"). F2 and F3 add their texts in files of their own
// (e.g. `payments-copy.ts`, `summary-copy.ts`), not here, so parallel branches don't collide.
import { CATALOG_NAME_MAX_LENGTH, EXPENSE_DESCRIPTION_MAX_LENGTH } from "./finance-constants";

export const FINANCE_COPY = {
  title: "Finanzas",
  pageTitle: "Finanzas · brahua-os",
  noticesLabel: "Avisos de Finanzas",
  captureNoticesLabel: "Avisos de la captura",
  undoHint: "Para deshacer, pulsa Ctrl+Z o ⌘Z, o usa el botón Deshacer del aviso.",
  undo: "Deshacer",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  notSavedTitle: "Sin guardar",
  newDay: "Empezó un nuevo día: actualizando Finanzas.",

  // The view switch (remembered per device)
  viewsLabel: "Vista de Finanzas",
  viewMonth: "Mes",
  viewPayments: "Pagos",
  /** F2 replaces it with the recurring payments. */
  paymentsEmpty: "Aquí verás tus pagos recurrentes.",

  // "Mes"
  monthHeading: (month: string) => `Gastos de ${month}`,
  emptyMonthTitle: "Sin gastos este mes",
  emptyMonthText:
    "Registra uno con «Registrar gasto» o con la tecla de captura: basta con el monto.",
  addExpense: "Registrar gasto",
  today: "Hoy",
  yesterday: "Ayer",
  uncategorized: "Sin categoría",
  recurring: "Recurrente",
  /** "≈ S/ 47.00" next to a USD amount converted with its stored rate. */
  approx: (pen: string) => `≈ ${pen}`,
  unconverted: "sin convertir",
  editExpense: (what: string, amount: string) => `Editar ${what}, ${amount}`,

  // Expense sheet (create, edit; also the quick capture's "Gasto")
  newExpense: "Nuevo gasto",
  editTitle: "Editar gasto",
  /** The currency shows in the label: the default comes from the method, under "Más". */
  amountLabel: (currency: "PEN" | "USD") =>
    currency === "USD" ? "Monto en dólares" : "Monto en soles",
  amountHelp: "Con punto o coma para los decimales: 12.50 o 12,50.",
  descriptionLabel: "Descripción (opcional)",
  descriptionHelp: "Por ejemplo, «Café» o «Mercado».",
  more: "Más",
  categoryLabel: "Categoría",
  noCategory: "Sin categoría",
  methodLabel: "Medio de pago",
  noMethod: "Sin medio de pago",
  archivedOption: (name: string) => `${name} (archivado)`,
  currencyLabel: "Moneda",
  currencyPEN: "Soles",
  currencyUSD: "Dólares",
  dateLabel: "Fecha",
  catalogLoading: "Cargando categorías y medios de pago…",
  catalogLoadFailed: "No se pudieron cargar las categorías y los medios. Puedes guardar igual.",
  usdRate: (rate: string) => `Se guardará con el tipo de cambio de Ajustes: S/ ${rate} por dólar.`,
  usdNoRate:
    "Sin tipo de cambio: este gasto se sumará aparte, sin convertir. Puedes fijarlo en Finanzas → Ajustes.",
  usdStoredRate: (rate: string) => `Guardado con S/ ${rate} por dólar.`,
  /** In the capture sheet, which stays open for the next one. */
  savedInSheet: (text: string) => `Registrado: ${text}.`,
  save: "Guardar",
  saving: "Guardando…",
  savingStatus: "Guardando el gasto…",
  close: "Cerrar",
  deleteExpense: "Eliminar gasto",
  deleteHelp: "Se quita del mes. Puedes deshacerlo desde el aviso.",

  // Notices and announcements
  savedTitle: "Gasto registrado",
  savedText: (amount: string, what: string | null) => (what ? `${amount} · ${what}` : amount),
  editedTitle: "Gasto guardado",
  deletedTitle: "Gasto eliminado",
  undoneCreate: "Se quitó el gasto.",
  restored: "El gasto volvió.",
  notUndone: "No se pudo deshacer.",
  notDeleted: "No se pudo eliminar el gasto.",

  // Ajustes
  settings: "Ajustes",
  settingsTitle: "Ajustes de Finanzas",
  settingsDescription: "Tipo de cambio, categorías y medios de pago.",
  rateHeading: "Tipo de cambio",
  rateLabel: "Soles por 1 dólar",
  rateHelp:
    "Cada gasto en dólares guarda el tipo vigente al registrarlo: cambiarlo no reescribe meses pasados. Déjalo vacío para quitarlo.",
  rateNotSet: "Sin fijar: los gastos en dólares se suman aparte, sin convertir.",
  rateSave: "Guardar tipo de cambio",
  rateSaved: (rate: string) => `Tipo de cambio guardado: S/ ${rate} por dólar.`,
  rateCleared: "Tipo de cambio quitado.",
  categoriesHeading: "Categorías",
  methodsHeading: "Medios de pago",
  categoriesEmpty: "Todavía no hay categorías.",
  methodsEmpty: "Todavía no hay medios de pago.",
  newCategory: "Nueva categoría",
  newMethod: "Nuevo medio de pago",
  add: "Agregar",
  adding: "Agregando…",
  nameLabel: "Nombre",
  defaultCurrency: "Moneda por defecto",
  moveUp: (name: string) => `Subir «${name}»`,
  moveDown: (name: string) => `Bajar «${name}»`,
  edit: (name: string) => `Editar «${name}»`,
  archive: (name: string) => `Archivar «${name}»`,
  unarchive: (name: string) => `Reactivar «${name}»`,
  reactivate: "Reactivar",
  cancel: "Cancelar",
  archivedCategories: (count: number) => `Archivadas (${count})`,
  archivedMethods: (count: number) => `Archivados (${count})`,
  created: (name: string) => `Se agregó «${name}».`,
  renamed: (name: string) => `Se guardó «${name}».`,
  archived: (name: string, list: string) => `Se archivó «${name}». Está en ${list}.`,
  unarchived: (name: string) => `Se reactivó «${name}», al final de la lista.`,
  moved: (name: string, position: number, total: number) =>
    `«${name}» ahora está en el puesto ${position} de ${total}.`,
} as const;

/** Lowercase in Spanish ("setiembre", es-PE), read in UTC so a YYYY-MM never shifts. */
const MONTH_NAME = new Intl.DateTimeFormat("es-PE", { month: "long", timeZone: "UTC" });
const DAY_TITLE = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Octubre 2026" for "2026-10". */
export function monthTitle(month: string): string {
  return `${capitalize(MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`)))} ${month.slice(0, 4)}`;
}

/** "Hoy", "Ayer" or "Lunes 5 de octubre" for a day of the list (both YYYY-MM-DD, Lima). */
export function dayTitle(day: string, today: string): string {
  if (day === today) return FINANCE_COPY.today;
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return FINANCE_COPY.yesterday;
  return capitalize(DAY_TITLE.format(new Date(`${day}T00:00:00Z`)).replace(",", ""));
}

export const EXPENSE_ERRORS = {
  amount: {
    required: "Escribe el monto.",
    invalid: "Escribe solo el número, con coma o punto para los decimales (12,50).",
    decimals: "Usa 2 decimales como máximo.",
    tooSmall: "El monto debe ser mayor que 0.",
    tooLarge: "El monto máximo es 1 000 000.",
  },
  descriptionTooLong: `Usa ${EXPENSE_DESCRIPTION_MAX_LENGTH} caracteres como máximo.`,
  descriptionInvisible: "Quita los caracteres invisibles o de control de la descripción.",
  currency: "Elige soles o dólares.",
  dateInvalid: "Esa fecha no es válida.",
  dateTooOld: "La fecha debe ser de 2000 en adelante.",
  dateFuture: "La fecha no puede ser posterior a hoy.",
  categoryUnavailable: "Esa categoría ya no está disponible (se archivó o no existe). Elige otra.",
  methodUnavailable:
    "Ese medio de pago ya no está disponible (se archivó o no existe). Elige otro.",
  notFound: "Este gasto ya no existe (se eliminó).",
} as const;

export const CATALOG_ERRORS = {
  nameRequired: "Escribe el nombre.",
  nameTooLong: `Usa ${CATALOG_NAME_MAX_LENGTH} caracteres como máximo.`,
  nameInvisible: "Quita los caracteres invisibles o de control del nombre.",
  currency: "Elige soles o dólares.",
  categoryTaken: "Ya hay una categoría con ese nombre.",
  methodTaken: "Ya hay un medio de pago con ese nombre.",
  notFound: "Ya no existe. Recarga la página e inténtalo de nuevo.",
  archived: "Está archivado: reactívalo para editarlo.",
  order: "El orden enviado no es válido. Recarga la página e inténtalo de nuevo.",
  staleOrder: "La lista cambió mientras la ordenabas. Ya está al día: vuelve a intentarlo.",
} as const;

export const RATE_ERRORS = {
  required: "Escribe el tipo de cambio.",
  invalid: "Escribe solo el número, con coma o punto para los decimales (3,75).",
  decimals: "Usa 4 decimales como máximo.",
  outOfRange: "Debe estar entre 1 y 10 soles por dólar.",
} as const;
