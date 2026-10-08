// Pure: the text of each reminder (SPEC-reminders "Avisos"). One place for the copy, so the test
// with the forbidden list ("racha", "riesgo", "⚠️", "atrasad", "deuda") covers every sentence a
// reminder can say. Sources (`tasks`, `habits`, `finance`) never write sentences: they hand over
// facts and call these functions through `contracts.ts`.
//
// Tone: calm, short, no guilt. A reminder is at most 3 lines (the briefing is one) and an amount
// shows only when the channel's "show amounts" switch is on.

/** One payment as the briefing and the payment reminders talk about it. */
export type PaymentFact = {
  name: string;
  /** The amount already formatted ("S/ 50.00"), or null for a variable one. */
  amountLabel: string | null;
};

/** What each module knows about a day, for the briefing. Every part is optional. */
export type BriefingFacts = {
  /** Habits due that day, not done and not paused. */
  habitsToday?: number;
  /** Pending tasks that are due that very day. */
  tasksDueToday?: number;
  /** Payments pending that fall due that day. */
  paymentsDueToday?: readonly PaymentFact[];
};

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** `2026-10-05` → `lun 5 oct` (a calendar day: no time zone involved). */
export function shortDayLabel(dayKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) throw new Error(`Invalid day key: ${dayKey}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "a", "a y b", "a, b y c". */
function naturalList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function paymentLabel(payment: PaymentFact, showAmounts: boolean): string {
  return showAmounts && payment.amountLabel
    ? `${payment.name} · ${payment.amountLabel}`
    : payment.name;
}

/** `(Netflix · S/ 50.00)`, `(A, B)` or `(A, B y 1 más)`: the payments the briefing names. */
function paymentsDetail(payments: readonly PaymentFact[], showAmounts: boolean): string {
  const shown = payments.slice(0, 2).map((payment) => paymentLabel(payment, showAmounts));
  const rest = payments.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} y ${rest} más` : shown.join(", ");
}

/**
 * The morning briefing: one line, «Buen día. Hoy: 3 hábitos, 2 tareas y 1 pago (Netflix · S/ 50).».
 * Null when the day has nothing (an empty day sends nothing).
 */
export function briefingText(facts: BriefingFacts, showAmounts: boolean): string | null {
  const parts: string[] = [];
  if (facts.habitsToday) parts.push(plural(facts.habitsToday, "hábito", "hábitos"));
  if (facts.tasksDueToday) parts.push(plural(facts.tasksDueToday, "tarea", "tareas"));
  const payments = facts.paymentsDueToday ?? [];
  if (payments.length > 0) {
    parts.push(
      `${plural(payments.length, "pago", "pagos")} (${paymentsDetail(payments, showAmounts)})`,
    );
  }
  if (parts.length === 0) return null;
  return `Buen día. Hoy: ${naturalList(parts)}.`;
}

/** «Mañana vence Netflix · S/ 50.00.» (`today` when the window crossed midnight: «Hoy vence …»). */
export function paymentEveText(
  payment: PaymentFact,
  options: { showAmounts: boolean; day?: "tomorrow" | "today" },
): string {
  const when = options.day === "today" ? "Hoy" : "Mañana";
  return `${when} vence ${paymentLabel(payment, options.showAmounts)}.`;
}

/** «Netflix sigue pendiente desde el lun 5 oct.» Never «atrasado»; no amount. */
export function paymentFollowupText(payment: Pick<PaymentFact, "name">, dueOn: string): string {
  return `${payment.name} sigue pendiente desde el ${shortDayLabel(dueOn)}.`;
}

/** How many habits the evening review names before saying «y N más». */
const EVENING_NAMED = 3;

/**
 * The evening review: «Te queda Leer. Si lo haces ahora, cuenta hoy.»; with several, a natural
 * sentence. Null when nothing is left (the caller sends nothing).
 */
export function eveningReviewText(habitNames: readonly string[]): string | null {
  if (habitNames.length === 0) return null;
  if (habitNames.length === 1) {
    return `Te queda ${habitNames[0]}. Si lo haces ahora, cuenta hoy.`;
  }
  const shown = habitNames.slice(0, EVENING_NAMED);
  const rest = habitNames.length - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} y ${rest} más` : naturalList(shown);
  return `Te quedan ${list}. Si los haces ahora, cuentan hoy.`;
}
