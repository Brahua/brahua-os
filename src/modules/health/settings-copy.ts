// Copy of «Ajustes» (E4, SPEC-health "Hábito enlazado"), in Spanish. Client-safe. No guilt
// (tests/modules/health-copy.test.ts scans it with the rest).

export const SETTINGS_ERRORS = {
  habitUnavailable: "Ese hábito ya no se puede enlazar. Elige otro de la lista.",
} as const;

export const SETTINGS_COPY = {
  link: "Ajustes",
  /** The line under «Ajustes» on /health: what a finished session does. */
  linkHelp: (habit: string | null, missing: boolean) => {
    if (missing) return "Al terminar una sesión: el hábito enlazado (ya no existe).";
    return habit === null
      ? "Al terminar una sesión: ningún hábito."
      : `Al terminar una sesión: marcar «${habit}».`;
  },
  title: "Ajustes de Entreno",
  habitLabel: "Al terminar una sesión, marcar el hábito",
  habitHelp: "Se marca el día en que termina la sesión. Si ya estaba hecho, no cambia nada.",
  none: "Ninguno",
  missing: "Hábito enlazado (ya no existe)",
  noOptions: "Aquí aparecen tus hábitos de sí o no para construir.",
  savedTitle: "Ajustes guardados",
  saved: (habit: string | null) =>
    habit === null
      ? "Al terminar una sesión no se marcará ningún hábito."
      : `Al terminar una sesión se marcará «${habit}».`,
  notSaved: "No se guardó el ajuste.",
  /** The finish notice when the session marked the linked habit (E4). */
  habitMarked: (habit: string) => `Marcaste «${habit}».`,
} as const;
