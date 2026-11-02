// Copy of `learning`'s tracks (SPEC-learning "Pantallas"), in Spanish. Client-safe. No guilt
// (SPEC-learning "Tono"): never «atrasado», «fallaste» or «deuda»; tests/modules/learning-copy.test.ts
// scans every string of the module's `*-copy.ts` files.
import {
  MAX_ACTIVE_TRACKS,
  STEP_TITLE_MAX_LENGTH,
  MAX_STEPS_PER_TRACK,
  TRACK_TITLE_MAX_LENGTH,
  TRACK_URL_MAX_LENGTH,
  type TrackKind,
  type TrackStatus,
} from "./learning-constants";
import { formatMinutes, type Pace } from "./pace";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const LONG_MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "setiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** «15 de diciembre de 2026» for a YYYY-MM-DD day. */
export function longDay(key: string): string {
  const [year, month, day] = String(key).split("-").map(Number);
  return `${day} de ${LONG_MONTHS[month - 1]} de ${year}`;
}

/** «15 dic» for a YYYY-MM-DD day (the year only when it isn't `today`'s). */
export function shortDay(key: string, today?: string): string {
  const [year, month, day] = String(key).split("-").map(Number);
  const base = `${day} ${MONTHS[month - 1]}`;
  return today && String(today).slice(0, 4) !== String(key).slice(0, 4) ? `${base} ${year}` : base;
}

export const KIND_LABELS: Record<TrackKind, string> = {
  certification: "Certificación",
  course: "Curso",
  book: "Libro",
  practice: "Práctica",
};

export const STATUS_LABELS: Record<TrackStatus, string> = {
  active: "En curso",
  waiting: "En espera",
  done: "Terminado",
};

export const LEARNING_ERRORS = {
  titleRequired: "Ponle un nombre.",
  titleTooLong: `Usa ${TRACK_TITLE_MAX_LENGTH} caracteres como máximo.`,
  invisible: "Quita los caracteres invisibles o de control.",
  kind: "Elige qué es: certificación, curso, libro o práctica.",
  status: "Elige si empieza en curso o en espera.",
  url: `Pega un enlace que empiece con http:// o https:// (hasta ${TRACK_URL_MAX_LENGTH} caracteres, sin espacios).`,
  weeklyTarget: "La meta semanal va de 15 min a 50 h.",
  targetDate: "Escribe una fecha válida.",
  project: "Elige un proyecto de la lista.",
  projectUnavailable: "Ese proyecto ya no está disponible. Elige otro o ninguno.",
  syllabusTooMany: `Un temario puede tener hasta ${MAX_STEPS_PER_TRACK} pasos.`,
  syllabusTooBig: "El texto pegado es demasiado largo para un temario.",
  syllabusTooLong: (line: number) =>
    `La línea ${line} pasa de ${STEP_TITLE_MAX_LENGTH} caracteres. Acórtala o pártela en dos.`,
  syllabusInvisible: (line: number) =>
    `La línea ${line} tiene caracteres invisibles o de control. Quítalos y vuelve a pegar.`,
  practiceSyllabus: "Una práctica no tiene temario: se mide en tiempo.",
  practiceHasSteps: "Para que sea una práctica, quita antes los pasos del temario.",
  limitReached: `Ya tienes ${MAX_ACTIVE_TRACKS} en curso. Pasa uno a «En espera» para empezar este.`,
  pauseUnavailable: "Ese frente ya no está en curso. Ya ves la lista actual.",
  notFound: "Este frente ya no existe (se eliminó). Ya ves la lista actual.",
  changed: "El frente cambió mientras tanto. Ya ves cómo está ahora.",
  invalid: "La petición no es válida. Recarga la página e inténtalo de nuevo.",
} as const;

export const LEARNING_COPY = {
  pageTitle: "Aprendizaje",
  noticesLabel: "Avisos de Aprendizaje",
  undoHint: "Para deshacer, usa el botón Deshacer del aviso.",
  undo: "Deshacer",
  undoneTitle: "Deshecho",
  notSavedTitle: "Sin guardar",
  notUndone: "No se pudo deshacer.",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  newDay: "Empezó un día nuevo.",

  // ── The list ───────────────────────────────────────────────────────────────────────────
  newTrack: "Nuevo frente",
  emptyTitle: "¿Qué quieres aprender?",
  emptyText:
    "Un frente es una certificación, un curso, un libro o una práctica. Pega su temario y la app te dice qué sigue.",
  emptyAction: "Crear mi primer frente",
  activeTitle: "En curso",
  activeCount: (count: number) => `${count} de ${MAX_ACTIVE_TRACKS}`,
  activeName: (count: number) => `En curso, ${count} de ${MAX_ACTIVE_TRACKS}`,
  activeEmpty: "Nada en curso ahora. Pon en curso uno de «En espera» cuando quieras.",
  activeHelp: `Como máximo ${MAX_ACTIVE_TRACKS} a la vez: pocos frentes avanzan más.`,
  waitingTitle: "En espera",
  waitingHelp: "Lo que espera su turno, sin apuro.",
  doneTitle: "Terminados",
  doneHelp: "Lo que ya terminaste. Puedes reabrir cualquiera.",
  groupName: (title: string, count: number) =>
    `${title}, ${count} ${count === 1 ? "frente" : "frentes"}`,
  listName: (title: string) => `Frentes ${String(title).toLowerCase()}`,

  // ── A track ────────────────────────────────────────────────────────────────────────────
  next: "Sigue con",
  nextName: (step: string) => `Sigue con: ${step}`,
  noSyllabus: "Agrega el temario para saber qué sigue.",
  practiceNote: "Una práctica se mide en tiempo, sin temario.",
  allDone: "Completaste el temario.",
  stepsCount: (done: number, total: number) => `${done} de ${total}`,
  stepsName: (title: string, done: number, total: number) =>
    `Temario de ${title}: ${done} de ${total} pasos`,
  weeklyTarget: (minutes: number) => `Meta: ${formatMinutes(minutes)} por semana`,
  pace: (pace: Pace, today?: string) =>
    pace.kind === "perWeek"
      ? `Para llegar al ${shortDay(pace.targetDate, today)}: ~${pace.perWeek} ${
          pace.perWeek === 1 ? "paso" : "pasos"
        } por semana`
      : "La fecha pasó: ponle otra o quítala",
  targetDate: (key: string) => `Fecha objetivo: ${longDay(key)}`,
  finishedOn: (key: string) => `Terminado el ${longDay(key)}`,
  open: (title: string) => `Abrir ${title}`,

  // ── The detail ─────────────────────────────────────────────────────────────────────────
  backToList: "Aprendizaje",
  detailTitle: (title: string) => `${title} · Aprendizaje · brahua-os`,
  notFoundTitle: "Frente no encontrado · brahua-os",
  notFoundLcd: "SIN FRENTE",
  notFoundHeading: "Este frente no existe",
  notFoundText: "Puede que se haya eliminado o que el enlace esté mal.",
  statusLine: (kind: TrackKind, status: TrackStatus) =>
    `${KIND_LABELS[kind]} · ${STATUS_LABELS[status]}`,
  project: "Proyecto",
  link: "Enlace del curso",
  linkName: (domain: string) => `Abrir el curso en ${domain} (pestaña nueva)`,
  actionsLabel: "Acciones del frente",
  activate: "Poner en curso",
  reopen: "Reabrir",
  pause: "Pasar a espera",
  finish: "Terminar",
  settings: "Ajustes",
  deleteTrack: "Eliminar",
  finishOffer: "Completaste el temario. ¿Lo das por terminado?",
  sessionsTitle: "Sesiones",

  // ── The limit of 2 ─────────────────────────────────────────────────────────────────────
  limitTitle: `Ya tienes ${MAX_ACTIVE_TRACKS} en curso`,
  limitText: (title: string) =>
    `Para poner «${title}» en curso, pasa uno a «En espera». Nada se pierde: lo retomas cuando quieras.`,
  limitPause: (title: string) => `Pasar «${title}» a espera`,
  limitCancel: "Ahora no",

  // ── Notices ────────────────────────────────────────────────────────────────────────────
  createdTitle: "Frente creado",
  created: (title: string, status: TrackStatus) =>
    status === "active" ? `«${title}» está en curso.` : `«${title}» quedó en espera.`,
  statusTitle: "Frente actualizado",
  statusChanged: (title: string, status: TrackStatus) =>
    status === "active"
      ? `«${title}» está en curso.`
      : status === "waiting"
        ? `«${title}» pasó a «En espera».`
        : `«${title}» está terminado.`,
  swapped: (paused: string, title: string) =>
    `«${paused}» pasó a «En espera» y «${title}» está en curso.`,
  statusRestored: "Volvió a como estaba.",
  finishedTitle: "¡Terminado!",
  savedTitle: "Guardado",
  saved: (title: string) => `Se guardaron los ajustes de «${title}».`,
  deletedTitle: "Frente eliminado",
  deleted: (title: string) => `«${title}» se eliminó.`,
  restored: (title: string) => `«${title}» volvió.`,
  restoredWaiting: (title: string) =>
    `«${title}» volvió en espera: ya tenías ${MAX_ACTIVE_TRACKS} en curso.`,
  notSaved: {
    create: "No se creó el frente.",
    status: "No se cambió el estado.",
    settings: "No se guardaron los ajustes.",
    delete: "No se eliminó el frente.",
  },

  // ── The form (new track and settings) ──────────────────────────────────────────────────
  newSheetTitle: "Nuevo frente",
  editSheetTitle: "Ajustes del frente",
  titleLabel: "Nombre",
  titlePlaceholder: "AWS Solutions Architect Associate",
  kindLabel: "Qué es",
  syllabusLabel: "Temario (opcional)",
  syllabusHelp: "Pega una línea por paso: clases, capítulos o temas. Las líneas vacías no cuentan.",
  syllabusCount: (count: number) =>
    count === 0 ? "Sin pasos todavía." : `${count} ${count === 1 ? "paso" : "pasos"}.`,
  statusLabel: "Empieza",
  statusOptions: { active: "En curso", waiting: "En espera" } as Record<
    "active" | "waiting",
    string
  >,
  fullNote: `Ya tienes ${MAX_ACTIVE_TRACKS} en curso. Para empezar este ahora, elige cuál pasa a «En espera»; si no, queda en espera.`,
  pauseChoiceLabel: "Pasa a espera",
  pauseNone: "Elige uno",
  rhythm: "Meta y fecha",
  rhythmHelp: "Opcional: horas por semana y un día al que quieres llegar.",
  weeklyLabel: "Meta semanal",
  hoursLabel: "Horas",
  minutesLabel: "Minutos",
  weeklyHelp: "Por ejemplo, 3 h. Vacía si no quieres meta.",
  dateLabel: "Fecha objetivo",
  dateHelp: "Por ejemplo, el día del examen. Vacía si no hay.",
  more: "Proyecto y enlace",
  moreHelp: "Opcional: el proyecto al que pertenece y el enlace del curso.",
  projectLabel: "Proyecto",
  projectNone: "Ninguno",
  urlLabel: "Enlace del curso",
  urlHelp: "Se abre en una pestaña nueva; la app no lo visita.",
  create: "Crear frente",
  save: "Guardar",
  cancel: "Cancelar",
} as const;
