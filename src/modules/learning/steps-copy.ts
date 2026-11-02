// Copy of a track's syllabus (SPEC-learning "Detalle"), in Spanish. Client-safe. No guilt
// (tests/modules/learning-copy.test.ts scans it with the rest of the module's copy).
import { MAX_STEPS_PER_TRACK, STEP_TITLE_MAX_LENGTH } from "./learning-constants";

export const STEP_ERRORS = {
  titleRequired: "Escribe el paso.",
  titleTooLong: `Usa ${STEP_TITLE_MAX_LENGTH} caracteres como máximo.`,
  invisible: "Quita los caracteres invisibles o de control del paso.",
  pasteEmpty: "Pega al menos una línea con texto.",
  tooMany: `Un temario puede tener hasta ${MAX_STEPS_PER_TRACK} pasos.`,
  noSyllabus: "Una práctica no tiene temario: se mide en tiempo.",
  notFound: "Este paso ya no existe (se quitó). Ya ves el temario actual.",
  order: "El orden enviado no es válido. Recarga la página e inténtalo de nuevo.",
  staleOrder: "El temario cambió mientras tanto. Ya ves el actual; vuelve a moverlo.",
  changed: "El paso cambió mientras tanto. Ya ves cómo está ahora.",
} as const;

export const STEPS_COPY = {
  section: "Temario",
  sectionName: (done: number, total: number) => `Temario, ${done} de ${total} pasos hechos`,
  listLabel: "Pasos del temario",
  empty: "Agrega el temario: pega la lista de clases, capítulos o temas, una por línea.",
  next: "Siguiente",
  // ── Check ───────────────────────────────────────────────────────────────────────────────
  done: "Hecho",
  doneName: (title: string) => `Marcar «${title}» como hecho`,
  check: (title: string) => `${title}: hecho`,
  doneTitle: "Paso hecho",
  doneNotice: (title: string) => `«${title}» está hecho.`,
  undoneTitle: "Paso sin marcar",
  undoneNotice: (title: string) => `«${title}» volvió a quedar sin marcar.`,
  // ── Add and paste ───────────────────────────────────────────────────────────────────────
  add: "Añadir paso",
  addLabel: "Nuevo paso",
  addHelp: "Enter añade otro.",
  added: (title: string) => `Se añadió «${title}».`,
  paste: "Pegar temario",
  pasteLabel: "Lista de pasos",
  pasteHelp: "Una línea por paso; se añaden al final. Las líneas vacías no cuentan.",
  pasteSubmit: "Añadir los pasos",
  pasteCancel: "Cancelar",
  pasteCount: (count: number) =>
    count === 0 ? "Sin pasos todavía." : `${count} ${count === 1 ? "paso" : "pasos"}.`,
  pastedTitle: "Temario añadido",
  pasted: (count: number) =>
    `Se ${count === 1 ? "añadió 1 paso" : `añadieron ${count} pasos`} al final.`,
  pasteRemoved: (count: number) =>
    `Se ${count === 1 ? "quitó el paso pegado" : `quitaron los ${count} pasos pegados`}.`,
  // ── Edit, remove and reorder ────────────────────────────────────────────────────────────
  edit: (title: string) => `Editar «${title}»`,
  editForm: "Editar paso",
  titleLabel: "Paso",
  titleHelp: `Hasta ${STEP_TITLE_MAX_LENGTH} caracteres.`,
  saved: "Paso guardado.",
  remove: "Quitar paso",
  removedTitle: "Paso quitado",
  removed: (title: string) => `«${title}» se quitó del temario.`,
  restored: (title: string) => `«${title}» volvió al temario.`,
  orderTitle: "Temario reordenado",
  moved: (title: string, place: string) => `«${title}» pasó al ${place}.`,
  orderRestored: "El temario volvió a su orden.",
  position: (index: number, total: number) =>
    index < 0 ? "lugar desconocido" : `lugar ${index + 1} de ${total}`,
  moveUp: (title: string) => `Subir «${title}»`,
  moveDown: (title: string) => `Bajar «${title}»`,
  drag: (title: string) => `Mover «${title}»`,
  dragRole: "paso que se puede mover",
  dragInstructions:
    "Para mover un paso, pulsa Espacio o Enter, usa las flechas arriba y abajo, y pulsa Espacio o Enter para soltarlo. Escape cancela.",
  dragStart: (title: string, place: string) => `Tomaste «${title}», ${place}.`,
  dragOver: (title: string, place: string) => `«${title}» va al ${place}.`,
  dragSame: (title: string, place: string) => `«${title}» se quedó en el ${place}.`,
  dragCancel: (title: string, place: string) => `Cancelado. «${title}» sigue en el ${place}.`,
  notSaved: {
    check: "No se guardó el paso.",
    add: "No se añadió el paso.",
    paste: "No se añadió el temario.",
    update: "No se guardó el cambio.",
    remove: "No se quitó el paso.",
    reorder: "No se guardó el orden.",
  },
} as const;
