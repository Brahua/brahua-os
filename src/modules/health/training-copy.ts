// Copy of Hoy's «Entreno» card (E4, SPEC-health "Hoy"), in Spanish. Client-safe. No guilt
// (tests/modules/health-copy.test.ts scans it with the rest).

export const TRAINING_COPY = {
  running: "Entreno en curso",
  /** «Rutina A · 23 min» (the minutes after hydration). */
  runningLine: (routine: string, minutes: number | null) =>
    minutes === null ? routine : `${routine} · ${minutes} min`,
  resume: "Seguir",
  resumeName: (routine: string) => `Seguir con ${routine}`,
  nextTitle: "Te toca entrenar",
  start: (routine: string) => `Empezar ${routine}`,
} as const;
