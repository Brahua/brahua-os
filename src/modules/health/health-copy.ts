// Copy shared by `health`'s screens and its /health page (SPEC-health "Pantallas"), in Spanish.
// Client-safe. No guilt (SPEC-health "Tono"): tests/modules/health-copy.test.ts scans every string
// of the module's `*-copy.ts` files.

export const HEALTH_COPY = {
  pageTitle: "Entreno",
  noticesLabel: "Avisos de Entreno",
  undoHint: "Para deshacer, usa el botón Deshacer del aviso.",
  undo: "Deshacer",
  undoneTitle: "Deshecho",
  notSavedTitle: "Sin guardar",
  notUndone: "No se pudo deshacer.",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  save: "Guardar",
  cancel: "Cancelar",

  // ── /health ────────────────────────────────────────────────────────────────────────────
  emptyTitle: "Arma tu primera rutina",
  emptyText:
    "Una rutina es la lista de ejercicios de un día de gimnasio, con sus series y su descanso. Créala y agrega sus ejercicios desde el catálogo.",
  more: "Más de Entreno",
  exercisesLink: "Ejercicios",
  exercisesHelp: "El catálogo: ejercicios comunes y los que crees.",
} as const;
