// Copy of `learning`'s time (L2, SPEC-learning "Cronómetro", "Sesión manual", "Meta semanal"), in
// Spanish. Client-safe. No guilt: below the target only what is left («Te faltan 1 h 40»), never a
// debt; tests/modules/learning-copy.test.ts scans every string here.
import { MANUAL_DAYS_BACK, SESSION_MAX_MINUTES, SESSION_MIN_MINUTES } from "./learning-constants";
import { shortDay } from "./learning-copy";
import { formatMinutes } from "./pace";

export const SESSION_ERRORS = {
  minutes: `Escribe de ${SESSION_MIN_MINUTES} a ${SESSION_MAX_MINUTES} minutos, en números enteros.`,
  day: `Elige hoy o un día de los últimos ${MANUAL_DAYS_BACK}.`,
  confirmNeeded: "El cronómetro corrió más de 4 h: confirma o corrige los minutos.",
  tooManyMinutes: (max: number) =>
    `El cronómetro corrió ${formatMinutes(max)}: anota esa cifra o una menor.`,
  notRunning: "Ese cronómetro ya no está corriendo. Ya ves cómo está ahora.",
  trackDone: "Este frente está terminado: reábrelo para estudiarlo con el cronómetro.",
  notFound: "Esa sesión ya no existe. Ya ves la lista actual.",
  changed: "El cronómetro cambió mientras tanto. Ya ves cómo está ahora.",
} as const;

export const SESSIONS_COPY = {
  // ── The timer ──────────────────────────────────────────────────────────────────────────
  study: "Estudiar",
  stop: "Detener",
  studyName: (title: string) => `Estudiar ${title}: iniciar el cronómetro`,
  stopName: (title: string) => `Detener el cronómetro de ${title}`,
  running: "Estudiando",
  /** Read by assistive tech instead of the ticking clock (it changes once a minute). */
  runningName: (minutes: number) => `Estudiando: ${formatMinutes(minutes)}`,
  runningElsewhere: (title: string) =>
    `El cronómetro corre en «${title}». Si estudias aquí, se detiene y se guarda.`,
  runningBanner: "Cronómetro en marcha",

  // ── The week ───────────────────────────────────────────────────────────────────────────
  weekFree: (minutes: number) => `${formatMinutes(minutes)} esta semana`,
  weekProgress: (minutes: number, target: number) =>
    `${formatMinutes(minutes)} de ${formatMinutes(target)} esta semana`,
  weekLeft: (left: number) => `Te faltan ${formatMinutes(left)}`,
  weekMet: (minutes: number, target: number) =>
    `Semana cumplida: ${formatMinutes(minutes)} de ${formatMinutes(target)}`,
  total: (minutes: number) => `${formatMinutes(minutes)} en total`,

  // ── The sessions ───────────────────────────────────────────────────────────────────────
  title: "Sesiones",
  log: "Anotar tiempo",
  empty:
    "Todavía no hay sesiones. «Estudiar» mide el tiempo; si estudiaste sin cronómetro, anótalo.",
  shownWeeks: (weeks: number) => `Se muestran las últimas ${weeks} semanas.`,
  thisWeek: "Esta semana",
  weekOf: (monday: string, today: string) => `Semana del ${shortDay(monday, today)}`,
  weekTotal: (minutes: number) => formatMinutes(minutes),
  weekName: (label: string, minutes: number) => `${label}: ${formatMinutes(minutes)}`,
  manual: "Anotado a mano",
  span: (from: string, to: string) => `${from}–${to}`,
  remove: "Quitar",
  removeName: (minutes: number, day: string) =>
    `Quitar la sesión de ${formatMinutes(minutes)} del ${day}`,

  // ── Sheets ─────────────────────────────────────────────────────────────────────────────
  logTitle: "Anotar tiempo",
  logDescription: (title: string) => `Lo que estudiaste de «${title}» sin cronómetro.`,
  minutesLabel: "Minutos",
  minutesHelp: `De ${SESSION_MIN_MINUTES} a ${SESSION_MAX_MINUTES}.`,
  dayLabel: "Día",
  save: "Guardar",
  cancel: "Cancelar",
  confirmTitle: "¿Cuánto estudiaste?",
  confirmText: (title: string, ran: number) =>
    `El cronómetro de «${title}» corrió ${formatMinutes(ran)}. Si lo dejaste corriendo, corrige los minutos.`,
  confirmSave: "Guardar sesión",

  // ── Notices ────────────────────────────────────────────────────────────────────────────
  startedTitle: "Cronómetro en marcha",
  started: (title: string) => `Estudiando «${title}».`,
  switched: (stopped: string, minutes: number, title: string) =>
    `Guardaste ${formatMinutes(minutes)} en «${stopped}». Ahora estudias «${title}».`,
  stoppedTitle: "Sesión guardada",
  stopped: (minutes: number, title: string) => `Guardaste ${formatMinutes(minutes)} en «${title}».`,
  loggedTitle: "Tiempo anotado",
  logged: (minutes: number, title: string, day: string) =>
    `Anotaste ${formatMinutes(minutes)} en «${title}» (${String(day).toLowerCase()}).`,
  removedTitle: "Sesión quitada",
  removed: (minutes: number) => `Se quitó la sesión de ${formatMinutes(minutes)}.`,
  restored: (minutes: number) => `La sesión de ${formatMinutes(minutes)} volvió.`,
  notSaved: {
    start: "No se inició el cronómetro.",
    stop: "No se detuvo el cronómetro.",
    log: "No se anotó el tiempo.",
    remove: "No se quitó la sesión.",
  },
} as const;
