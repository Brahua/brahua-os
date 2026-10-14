// Spanish copy of the email suggestions (SPEC-finance-email). Neutral tone: no counters of debt, no
// red (principios UX 7 y 8).
import type { EmailSource } from "./constants";

const SOURCE_NAMES: Record<EmailSource, string> = { bcp: "BCP", bbva: "BBVA", yape: "Yape" };
export const sourceName = (source: EmailSource) => SOURCE_NAMES[source];

export const EMAIL_COPY = {
  heading: "Sugerencias",
  countLabel: (count: number) => (count === 1 ? "1 sugerencia" : `${count} sugerencias`),
  description:
    "Gastos que encontré en tus correos del banco. Nada se registra sin que lo confirmes.",
  register: "Registrar",
  review: "Revisar",
  edit: "Editar",
  dismiss: "Descartar",
  registerByHand: "Registrar a mano",
  unreadable: "No pude leerlo",
  unreadableHelp: "El correo no tiene el formato que conozco.",
  possibleDuplicate: "Posible duplicado",
  possibleDuplicateHelp: "Ya hay un gasto igual ese día.",
  unverified: "Remitente no verificado",
  unverifiedHelp: "Gmail no pudo comprobar quién lo envió: revísalo antes de registrar.",
  sheetTitle: "Registrar sugerencia",
  sheetDescription: (source: string) => `Leído de un correo de ${source}.`,
  sheetSave: "Registrar gasto",
  saving: "Guardando…",
  noticesLabel: "Avisos de sugerencias",
  registeredTitle: "Gasto registrado",
  registeredText: (spoken: string, label: string) => `${label}, ${spoken}.`,
  dismissedTitle: "Sugerencia descartada",
  dismissedText: (label: string) => `${label}.`,
  undo: "Deshacer",
  undone: "Deshecho.",
  notSavedTitle: "Sin guardar",
  notRegistered: "No se pudo registrar.",
  notDismissed: "No se pudo descartar.",
  notUndone: "No se pudo deshacer.",
  checkConnection: "Revisa tu conexión e inténtalo de nuevo.",
  needsReview:
    "Revisa esta sugerencia antes de registrarla: no pude verificar quién envió el correo.",
  correct: (amount: string) => `Corregir a ${amount}`,
  paidDiffers: (paid: string, charged: string) => `Registraste ${paid}; el banco cobró ${charged}.`,
  correctedTitle: "Monto corregido",
  correctedText: (name: string, spoken: string) => `${name}, ahora ${spoken}.`,
  markPaid: "Marcar como pagado",
  registerAsExpense: "Registrar como gasto",
  seemsPayment: (name: string, due: string) => `Parece el pago de «${name}» · ${due}`,
  dueToday: "vence hoy",
  dueOn: (label: string) => `vence el ${label}`,
  wasDueOn: (label: string) => `venció el ${label}`,
  amountDiffers: (expected: string, charged: string) =>
    `El monto es distinto del previsto (${expected}): se marca con lo que cobró el banco (${charged}).`,
  alreadyPaidNote: (name: string) => `Ya marcaste «${name}» como pagado este mes.`,
  markedTitle: "Pago marcado",
  markedText: (name: string, spoken: string) => `${name}, ${spoken}.`,
  noMatch: "Ya no parece el pago de un recurrente: revisa la sugerencia.",
  alreadyDecided: "Esta sugerencia ya se decidió.",
  changedMeanwhile: "Cambió mientras tanto.",
  notFound: "No encontré esa sugerencia.",
  // Ajustes
  settingsHeading: "Correos del banco",
  settingsHelp:
    "Con los últimos 4 dígitos de cada tarjeta sugiero el medio de pago; con tus nombres ignoro las transferencias a tus propias cuentas.",
  last4Label: (method: string) => `Últimos 4 dígitos de ${method}`,
  last4Help: "Cuatro dígitos, como aparecen en el correo. Vacío: sin tarjeta.",
  last4Save: "Guardar dígitos",
  last4Saved: (method: string) => `Dígitos de ${method} guardados.`,
  last4Cleared: (method: string) => `Dígitos de ${method} quitados.`,
  namesLabel: "Mis nombres",
  namesHelp:
    "Uno por línea, como te llama el banco («Jhorman Josue Bravo Huaman»). También reconozco abreviaturas («Jhorman J Bravo H»).",
  namesSave: "Guardar nombres",
  namesSaved: "Nombres guardados.",
  namesCleared: "Nombres quitados.",
  noMethods: "Aún no hay medios de pago.",
} as const;

export const EMAIL_ERRORS = {
  last4: "Escribe exactamente 4 dígitos, o déjalo vacío.",
  nameTooLong: "Cada nombre admite hasta 80 caracteres.",
  nameInvisible: "Un nombre tiene caracteres invisibles.",
  tooManyNames: "Puedes guardar hasta 10 nombres.",
  methodGone: "Ese medio de pago ya no existe o está archivado.",
} as const;
