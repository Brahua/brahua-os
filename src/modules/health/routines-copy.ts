// Copy of the routines and their exercises (SPEC-health "Rutinas", "Pantallas"), in Spanish.
// Client-safe. No guilt (tests/modules/health-copy.test.ts scans it with the rest of the copy).
import {
  MAX_ROUTINE_ITEMS,
  REST_MAX_SECONDS,
  REST_MIN_SECONDS,
  ROUTINE_NAME_MAX_LENGTH,
  TARGET_REPS_MAX,
  TARGET_REPS_MIN,
  TARGET_SETS_MAX,
  TARGET_SETS_MIN,
} from "./health-constants";
import { formatDuration } from "./format";

export const ROUTINE_ERRORS = {
  nameRequired: "Ponle un nombre.",
  nameTooLong: `Usa ${ROUTINE_NAME_MAX_LENGTH} caracteres como máximo.`,
  invisible: "Quita los caracteres invisibles o de control.",
  notFound: "Esta rutina ya no existe (se eliminó). Ya ves la lista actual.",
  itemNotFound: "Este ejercicio ya no está en la rutina. Ya ves la rutina actual.",
  exerciseUnavailable: "Ese ejercicio ya no está en el catálogo. Elige otro.",
  tooMany: `Una rutina puede tener hasta ${MAX_ROUTINE_ITEMS} ejercicios.`,
  sets: `Las series van de ${TARGET_SETS_MIN} a ${TARGET_SETS_MAX}.`,
  reps: `Las repeticiones van de ${TARGET_REPS_MIN} a ${TARGET_REPS_MAX}.`,
  repsOrder: "El mínimo no puede pasar del máximo.",
  seconds: "Escribe un tiempo entre 1 segundo y 10 horas.",
  minutes: "Escribe los minutos (hasta 600).",
  rest: `El descanso va de ${formatDuration(REST_MIN_SECONDS)} a ${formatDuration(REST_MAX_SECONDS)}.`,
  wrongTarget: "Ese ejercicio cambió cómo se mide. Ya ves la rutina actual.",
  itemsChanged:
    "Un ejercicio de la rutina cambió cómo se mide o se eliminó mientras tanto, así que la rutina no puede volver.",
  targetsChanged: "El ejercicio cambió cómo se mide, así que no puede volver con esos objetivos.",
  order: "El orden enviado no es válido. Recarga la página e inténtalo de nuevo.",
  staleOrder: "La lista cambió mientras tanto. Ya ves la actual; vuelve a moverla.",
  idTaken: "No se pudo guardar. Inténtalo de nuevo en un momento.",
} as const;

export const ROUTINES_COPY = {
  // ── The list on /health ────────────────────────────────────────────────────────────────
  section: "Rutinas",
  sectionName: (count: number) => `Rutinas, ${count}`,
  listLabel: "Rutinas",
  newRoutine: "Nueva rutina",
  exerciseCount: (count: number) =>
    count === 0 ? "Sin ejercicios" : count === 1 ? "1 ejercicio" : `${count} ejercicios`,
  open: (name: string) => `Abrir ${name}`,
  orderTitle: "Rutinas reordenadas",
  orderRestored: "Las rutinas volvieron a su orden.",
  dragRole: "rutina que se puede mover",
  createdTitle: "Rutina creada",
  created: (name: string) => `«${name}» está lista: agrega sus ejercicios.`,
  defaultName: (letter: string) => `Rutina ${letter}`,

  // ── A routine's page ───────────────────────────────────────────────────────────────────
  backToHealth: "Entreno",
  detailTitle: (name: string) => `${name} · Entreno · brahua-os`,
  notFoundTitle: "Rutina no encontrada · brahua-os",
  notFoundLcd: "SIN RUTINA",
  notFoundHeading: "Esta rutina no existe",
  notFoundText: "Puede que se haya eliminado o que el enlace esté mal.",
  rename: (name: string) => `Cambiar el nombre de «${name}»`,
  renameForm: "Nombre de la rutina",
  nameLabel: "Nombre",
  nameHelp: `Hasta ${ROUTINE_NAME_MAX_LENGTH} caracteres.`,
  renamed: "Nombre guardado.",
  deleteRoutine: "Eliminar rutina",
  actionsLabel: "Acciones de la rutina",
  deletedTitle: "Rutina eliminada",
  deleted: (name: string) => `«${name}» se eliminó.`,
  restored: (name: string) => `«${name}» volvió.`,

  // ── Its exercises ──────────────────────────────────────────────────────────────────────
  items: "Ejercicios",
  itemsName: (count: number) => `Ejercicios, ${count} de ${MAX_ROUTINE_ITEMS}`,
  itemsLabel: "Ejercicios de la rutina",
  itemsEmpty: "Agrega el primer ejercicio: búscalo en el catálogo.",
  itemsFull: `La rutina tiene ${MAX_ROUTINE_ITEMS} ejercicios, el máximo.`,
  addItem: "Agregar ejercicio",
  restLine: (rest: string) => `Descanso ${rest}`,
  restFromExercise: (rest: string) => `Descanso ${rest} (del ejercicio)`,
  editItem: (name: string) => `Editar «${name}» en la rutina`,
  itemForm: (name: string) => `Objetivos de «${name}»`,
  setsLabel: "Series",
  repsMinLabel: "Reps mínimas",
  repsMaxLabel: "Reps máximas",
  repsHelp: "Iguales si es un número fijo.",
  secondsLabel: "Segundos por serie",
  minutesLabel: "Minutos por serie",
  restLabel: "Descanso",
  restDefault: (rest: string) => `El del ejercicio (${rest})`,
  removeItem: "Quitar de la rutina",
  added: (name: string) => `Se agregó «${name}».`,
  itemSaved: "Objetivos guardados.",
  removedTitle: "Ejercicio quitado",
  removed: (name: string) => `«${name}» se quitó de la rutina.`,
  itemRestored: (name: string) => `«${name}» volvió a la rutina.`,
  itemsOrderTitle: "Ejercicios reordenados",
  itemsOrderRestored: "Los ejercicios volvieron a su orden.",
  itemDragRole: "ejercicio que se puede mover",

  // ── The picker ─────────────────────────────────────────────────────────────────────────
  pickerTitle: "Agregar ejercicio",
  pickerSearch: "Buscar en el catálogo",
  pickerList: "Ejercicios del catálogo",
  pickerAdd: (name: string) => `Agregar «${name}»`,
  pickerNone: "Ningún ejercicio coincide.",
  pickerCreate: (name: string) => `Nuevo ejercicio «${name}»`,
  pickerCreateEmpty: "Nuevo ejercicio",

  // ── Reorder (shared by both lists) ─────────────────────────────────────────────────────
  position: (index: number, total: number) =>
    index < 0 ? "lugar desconocido" : `lugar ${index + 1} de ${total}`,
  moved: (name: string, place: string) => `«${name}» pasó al ${place}.`,
  moveUp: (name: string) => `Subir «${name}»`,
  moveDown: (name: string) => `Bajar «${name}»`,
  drag: (name: string) => `Mover «${name}»`,
  dragInstructions:
    "Para mover una fila, pulsa Espacio o Enter, usa las flechas arriba y abajo, y pulsa Espacio o Enter para soltarla. Escape cancela.",
  dragStart: (name: string, place: string) => `Tomaste «${name}», ${place}.`,
  dragOver: (name: string, place: string) => `«${name}» va al ${place}.`,
  dragSame: (name: string, place: string) => `«${name}» se quedó en el ${place}.`,
  dragCancel: (name: string, place: string) => `Cancelado. «${name}» sigue en el ${place}.`,

  notSaved: {
    create: "No se creó la rutina.",
    rename: "No se guardó el nombre.",
    delete: "No se eliminó la rutina.",
    reorder: "No se guardó el orden.",
    add: "No se agregó el ejercicio.",
    update: "No se guardaron los objetivos.",
    remove: "No se quitó el ejercicio.",
  },
} as const;
