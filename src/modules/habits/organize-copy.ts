// User-facing copy of H2's "organize" part of habits (Spanish): what is due today and what isn't,
// editing, archiving and reactivating, and the manual order. Its own file, apart from
// habits-copy.ts, so H3 and H4 never touch the same lines. Never guilt (docs/principios-ux.md).

export const ORGANIZE_ERRORS = {
  staleOrder: "La lista cambió mientras la ordenabas: ya está al día. Vuelve a intentarlo.",
  order: "Ese orden no es válido.",
  archivedEdit: "Este hábito está archivado: reactívalo para editarlo.",
} as const;

export const ORGANIZE_COPY = {
  // "Hoy": what isn't due today
  nothingTodayTitle: "Nada toca hoy",
  nothingTodayText:
    "Tus hábitos de días fijos aparecen el día que les toca. Si igual quieres registrar alguno, está en «No tocan hoy».",
  notDueTitle: "No tocan hoy",
  notDueHelp: "Son de otros días de la semana. Si igual lo hiciste hoy, puedes registrarlo.",
  notDueList: "Hábitos que no tocan hoy",

  // Edit
  edit: "Editar",
  editHabit: "Editar hábito",
  save: "Guardar cambios",
  saving: "Guardando…",
  savingStatus: "Guardando cambios…",
  updated: (name: string) => `Cambios guardados en «${name}».`,
  nowNotDue: "Está en «No tocan hoy».",
  archivedArea: (name: string) => `${name} (archivada)`,

  // Archive and reactivate
  archive: "Archivar",
  archiveHelp:
    "Lo terminaste o lo dejas por ahora: sale de «Hoy» y conserva todo. Lo reactivas desde «Archivados».",
  archivedNoticeTitle: "Archivado",
  archivedNotice: (name: string) => `«${name}» se archivó.`,
  notArchived: "No se pudo archivar.",
  archivedTitle: "Archivados",
  archivedHelp: "Sus días registrados se conservan. Al reactivarlo vuelve al final de «Hoy».",
  archivedList: "Hábitos archivados",
  reactivate: "Reactivar",
  reactivateRow: (name: string) => `Reactivar «${name}»`,
  reactivatedTitle: "Reactivado",
  reactivated: (name: string) => `«${name}» volvió a tus hábitos.`,
  notReactivated: "No se pudo reactivar.",
  backInPlace: (name: string) => `«${name}» volvió a su lugar.`,
  archivedAgain: (name: string) => `«${name}» volvió a Archivados.`,
  undoneTitle: "Deshecho",

  // Order
  order: "Ordenar",
  orderTitle: "Ordenar hábitos",
  orderHelp:
    "Arrastra el asa o usa Subir y Bajar. El orden es el de «Hoy»; incluye los hábitos que no tocan hoy.",
  orderList: "Orden de tus hábitos",
  moveUp: (name: string) => `Subir «${name}»`,
  moveDown: (name: string) => `Bajar «${name}»`,
  drag: (name: string) => `Mover «${name}»`,
  dragRole: "elemento ordenable",
  dragInstructions:
    "Para mover un hábito, pulsa Espacio o Enter, muévelo con las flechas arriba y abajo y vuelve a pulsar Espacio o Enter para dejarlo. Escape cancela. En pantallas táctiles, mantén presionado y arrastra. También puedes usar los botones Subir y Bajar.",
  position: (index: number, total: number) => `lugar ${index + 1} de ${total}`,
  dragStart: (name: string, place: string) => `Tomaste «${name}», en el ${place}.`,
  dragOver: (name: string, place: string) => `«${name}» está en el ${place}.`,
  dragSame: (name: string, place: string) => `«${name}» quedó en el mismo ${place}.`,
  dragCancel: (name: string, place: string) => `Cancelado. «${name}» volvió al ${place}.`,
  orderNoticeTitle: "Orden",
  moved: (name: string, place: string) => `«${name}» pasó al ${place}.`,
  orderRestored: "El orden volvió a como estaba.",
  orderFailed: "No se pudo guardar el orden.",
} as const;
