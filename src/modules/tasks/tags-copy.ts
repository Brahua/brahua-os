// User-facing copy of the tags of tasks (T4, Spanish). Its own file: T2 and T3 edit
// tasks-copy.ts in parallel.
import { TASK_TAG_NAME_MAX_LENGTH, TASK_TAGS_MAX as MAX } from "./task-constants";

export const TAGS_COPY = {
  label: "Etiquetas",
  inputLabel: "Agregar etiqueta",
  placeholder: "p. ej. compras",
  help: "Enter o coma para agregarla. Se crean al escribirlas.",
  count: (count: number) => `${count} de ${MAX}.`,
  full: `Ya tiene ${MAX} etiquetas: quita una para agregar otra.`,
  chosenList: "Etiquetas elegidas",
  none: "Sin etiquetas.",
  remove: (name: string) => `Quitar la etiqueta «${name}»`,
  suggestions: "Etiquetas existentes",
  create: (name: string) => `Crear «${name}»`,
  added: (name: string) => `Se agregó la etiqueta «${name}».`,
  removed: (name: string) => `Se quitó la etiqueta «${name}».`,
  already: (name: string) => `Ya tiene la etiqueta «${name}».`,
  suggestionsCount: (count: number) =>
    count === 0 ? "" : count === 1 ? "1 sugerencia." : `${count} sugerencias.`,
  /** What the row's description says (the visible chips are aria-hidden). */
  rowDescription: (names: readonly string[]) =>
    names.length === 1 ? `Etiqueta: ${names[0]}` : `Etiquetas: ${names.join(", ")}`,
  /** "+2": the chips that don't fit in a row. */
  more: (count: number) => `+${count}`,
  fieldName: "las etiquetas",

  // Filter ("Todas")
  filterTrigger: "Etiqueta:",
  filterAll: "Todas",
  filterTriggerName: (label: string) => `Filtrar por etiqueta: ${label}`,
  filterTitle: "Filtrar por etiqueta",
  filterOptions: "Etiquetas",
  filterAllOption: "Todas las etiquetas",
  filterNone: "Todavía no hay etiquetas. Agrégalas en el detalle de una tarea o al capturarla.",
  filterApplied: (name: string | null) =>
    name ? `Mostrando tareas con la etiqueta «${name}».` : "Mostrando tareas con cualquier etiqueta.",

  errors: {
    empty: "Escribe el nombre de la etiqueta.",
    tooLong: `Usa ${TASK_TAG_NAME_MAX_LENGTH} caracteres como máximo por etiqueta.`,
    comma: "Una etiqueta no puede tener comas: la coma las separa.",
    invisible: "Quita los caracteres invisibles o de control de la etiqueta.",
    tooMany: `Usa ${MAX} etiquetas como máximo.`,
    list: "Las etiquetas no son válidas.",
    taskNotFound: "Esta tarea ya no existe (se eliminó).",
  },
} as const;
