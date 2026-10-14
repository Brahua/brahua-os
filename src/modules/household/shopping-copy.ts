// User-facing copy of the shopping list (Spanish). No guilt, nothing about what is missing as a
// debt; a test scans every string here (tests/modules/household-copy.test.ts).
import { PRODUCT_CATEGORIES, type ProductCategory } from "./shopping-constants";

export const CATEGORY_LABELS = {
  verduras: "Verduras",
  frutas: "Frutas",
  carnes: "Carnes",
  lacteos: "Lácteos",
  especerias: "Especerías",
  productos_naturales: "Productos naturales",
  limpieza: "Limpieza",
  otros: "Otros",
} satisfies Record<ProductCategory, string>;

export const SHOPPING_ERRORS = {
  name: "Escribe el nombre del producto.",
  nameTooLong: "Usa 80 caracteres o menos.",
  invisible: "Tiene caracteres que no se ven.",
  quantity: "Escribe una cantidad válida.",
  quantityTooLong: "Usa 30 caracteres o menos.",
  category: "Elige una categoría.",
  notFound: "Ese producto ya no está.",
  instant: "No se pudo deshacer.",
  tooMany: "Son demasiados productos.",
  duplicates: "Hay productos repetidos.",
  nameTaken: "Ya hay otro producto con ese nombre.",
} as const;

export const SHOPPING_COPY = {
  noticesLabel: "Avisos de compras",
  undoHint: "Se puede deshacer",

  // The add form
  addTitle: "Añadir producto",
  nameLabel: "Producto",
  namePlaceholder: "Leche",
  categoryLabel: "Categoría",
  quantityLabel: "Cantidad",
  quantityPlaceholder: "2 kg",
  add: "Añadir",
  suggestionsLabel: "Ya los compraste antes",
  suggestionName: (name: string, category: string) => `Añadir ${name} (${category})`,
  alreadyOnList: (name: string) => `«${name}» ya está en la lista.`,
  added: (name: string) => `Añadiste «${name}».`,

  // The list
  emptyTitle: "La lista está vacía.",
  emptyText: "Escribe un producto arriba y aparecerá aquí, en su sección.",
  bought: "Comprado",
  boughtName: (name: string) => `Comprado: ${name}`,
  quantityName: (name: string) => `Cantidad de ${name}`,
  remove: "Quitar",
  removeName: (name: string) => `Quitar de la lista: ${name}`,
  count: (count: number) => (count === 1 ? "1 producto" : `${count} productos`),

  // Bought
  boughtTitle: "Comprados",
  boughtCount: (count: number) => (count === 1 ? "1 comprado" : `${count} comprados`),
  finish: "Terminé la compra",
  finishNone: "Nada comprado todavía",
  finishedTitle: "Compra terminada",
  finished: (count: number) =>
    count === 1 ? "Guardaste 1 producto." : `Guardaste ${count} productos.`,
  finishedNothing: "No había nada que guardar.",
  undo: "Deshacer",
  undone: (count: number) =>
    count === 1 ? "Volvió 1 producto a comprados." : `Volvieron ${count} productos a comprados.`,
  undonePartial: (restored: number, kept: number) =>
    `Volvieron ${restored}; ${kept} ya los habías cambiado.`,
  notRestored: (count: number) =>
    count === 1 ? "Ese producto ya lo habías cambiado." : `Esos ${count} ya los habías cambiado.`,

  // Saved products (the catalog)
  savedTitle: "Productos guardados",
  savedHelp: "Lo que ya compraste. Toca uno para volver a ponerlo en la lista.",
  savedEmpty: "Aquí aparecerán los productos que compres.",
  savedAdd: (name: string) => `Poner en la lista: ${name}`,
  forget: "Olvidar",
  forgetName: (name: string) => `Olvidar producto: ${name}`,
  forgotTitle: "Producto olvidado",
  forgot: (name: string) => `Olvidaste «${name}».`,
  restored: (name: string) => `«${name}» volvió.`,
  removedTitle: "Quitado de la lista",
  removed: (name: string) => `Quitaste «${name}» de la lista.`,
  backOnList: (name: string) => `«${name}» volvió a la lista.`,

  // Failures
  notSavedTitle: "Sin guardar",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  notAdded: "No se pudo añadir.",
  notUpdated: "No se pudo guardar el cambio.",
  notRemoved: "No se pudo quitar.",
  notForgotten: "No se pudo olvidar.",
  notFinished: "No se pudo terminar la compra.",
  notUndone: "No se pudo deshacer.",
} as const;

/** The categories as the select offers them, in walking order. */
export const CATEGORY_OPTIONS = PRODUCT_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));
