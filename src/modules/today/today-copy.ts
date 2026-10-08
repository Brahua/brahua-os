// UI copy of the daily board ("Hoy", SPEC-today), in Spanish. Never guilt: no "fallaste", no
// debt counters (docs/principios-ux.md, "Lo que no haremos").

export const TODAY_COPY = {
  pageTitle: "Hoy · brahua-os",
  noticesLabel: "Avisos",
  undoHint: "Para deshacer, pulsa Ctrl+Z o ⌘Z, o usa el botón Deshacer del aviso.",
  /** Announced when Lima's day changes with the board open (the page is read again). */
  newDay: "Empezó un nuevo día: actualizando Hoy.",

  // ── Hábitos (D1) ──
  habitsTitle: "Hábitos",
  /** "2 de 3" next to the title; the hidden suffix says what is counted. */
  habitsCount: (done: number, total: number) => `${done} de ${total}`,
  habitsCountSuffix: " cumplidos",
  habitsList: "Hábitos de hoy",
  seeHabits: "Ver hábitos",
  /** The corner key of a quantity pad: opens "Ajustar el día" straight away. */
  adjust: (name: string) => `Ajustar «${name}»`,

  // ── Tareas (D2) ──
  tasksTitle: "Tareas",
  /** The total next to the title (live: a completed task leaves it at once). */
  tasksCount: (n: number) => `${n}`,
  tasksCountSuffix: " para hoy",
  tasksList: "Tareas de hoy",
  /** The fold: "Ver 6 más" / "Ver menos" (SPEC-today: 3 shown, the rest folded). */
  tasksMore: (n: number) => `Ver ${n} más`,
  tasksLess: "Ver menos",
  seeTasks: "Ver tareas",

  // ── Día completo (D4) ──
  dayCompleteTitle: "Día completo",
  /**
   * The closing line, one per day (`variantForDay`: stable all day, different across days;
   * principle 15, variable with moderation). Calm, never guilt nor pressure for tomorrow.
   */
  dayCompleteMessages: [
    "Hiciste lo que tocaba hoy. Lo demás puede esperar.",
    "Todo listo por hoy. Buen trabajo.",
    "Cerraste el día. Disfruta lo que queda.",
    "Nada pendiente para hoy. Tómate un respiro.",
    "Lo de hoy está hecho. Mañana, pizarra limpia.",
    "Un día bien aprovechado. Descansa.",
  ],
  /** What was achieved today, "5 hábitos · 4 tareas" (a part at 0 is left out). */
  dayCompleteHabits: (n: number) => (n === 1 ? "1 hábito" : `${n} hábitos`),
  dayCompleteTasks: (n: number) => (n === 1 ? "1 tarea" : `${n} tareas`),
  dayCompleteLabel: "Logrado hoy",
  /** Announced once when the day becomes complete with the board open (not on load). */
  dayCompleteAnnouncement: (achieved: string[]) =>
    achieved.length > 0 ? `Día completo: ${achieved.join(" y ")}.` : "Día completo.",

  // ── Cierre del día (evening-close-ritual) ──
  /**
   * From 20:00 (Lima), when something is left: what was achieved first, then one question about
   * the tasks left. Calm, never guilt nor a debt counter (principles 5 and 13): the tasks "pass
   * to tomorrow", they are not "late". One question per day (`variantForDay`).
   */
  eveningClose: {
    title: "Cierre del día",
    /** "Hoy: 4 hábitos · 3 tareas" (the visible parts; the spoken one is `achievedSpoken`). */
    achievedPrefix: "Hoy: ",
    achievedSpoken: (parts: string[]) => `Hoy: ${parts.join(" y ")}.`,
    habitsOf: (done: number, total: number) => `Hábitos: ${done} de ${total}`,
    questions: [
      (n: number) =>
        n === 1
          ? "Queda 1 tarea. ¿La pasamos a mañana?"
          : `Quedan ${n} tareas. ¿Las pasamos a mañana?`,
      (n: number) =>
        n === 1
          ? "Una tarea quedó para otro momento. ¿La movemos a mañana?"
          : `${n} tareas quedaron para otro momento. ¿Las movemos a mañana?`,
      (n: number) =>
        n === 1
          ? "Mañana hay espacio para esa tarea. ¿La movemos?"
          : `Mañana hay espacio para esas ${n} tareas. ¿Las movemos?`,
    ],
    tomorrow: "Mañana",
    keep: "Dejar aquí",
    /** Said after "Dejar aquí" (the tasks stay where they are; nothing else changes). */
    kept: "Las tareas se quedan en Hoy.",
  },

  // ── Línea bajo el saludo (greeting-variants) ──
  /**
   * The second line under the greeting, by part of the Lima day and the day's state (`greeting.ts`).
   * 3–4 variants each, one per day (`variantForDay`: stable all day, different across days;
   * principle 15, variable with moderation). A function variant takes how many things the day has
   * (what it holds, never "what is left behind") and is only used when there is at least one.
   * No line for a finished or an empty day: "Día completo" and "Nada programado para hoy" already
   * say it. Never guilt, pressure, urgency or a debt counter (checked by `tests/modules/greeting`).
   */
  greetingLines: {
    none: {
      morning: [
        (count: number) =>
          `Empieza por lo que importa: hay ${count} ${count === 1 ? "cosa" : "cosas"} arriba.`,
        "La mañana es tranquila. Empieza por lo que importa.",
        "Un paso a la vez. El primero puede ser el más pequeño.",
        "Buen momento para arrancar con algo sencillo.",
      ],
      afternoon: [
        "La tarde sigue abierta. Elige una cosa para empezar.",
        "Empezar con algo pequeño también cuenta.",
        "Hay tiempo para una primera cosa. Elige la más ligera.",
        "Un primer paso basta para poner el día en marcha.",
      ],
      evening: [
        "Fue un día tranquilo. Si quieres, cierra una cosa pequeña.",
        "Esta noche puedes descansar o cerrar algo sencillo.",
        "Mañana habrá otra página. Hoy, lo que tú decidas.",
        "Una cosa pequeña basta, o nada: tú decides.",
      ],
    },
    some: {
      morning: [
        "Buen arranque. Sigue a tu ritmo.",
        "Primera cosa hecha. El resto, con calma.",
        "La mañana va tomando forma.",
        "Buen comienzo del día.",
      ],
      afternoon: [
        "Vas a buen ritmo. Lo que queda cabe en la tarde.",
        "Vas por buen camino. Sigue a tu ritmo.",
        "Lo hecho cuenta. Lo demás puede ir con calma.",
        "La tarde va bien. Un paso más cuando quieras.",
      ],
      evening: [
        "Buen día de avance. Puedes ir cerrando.",
        "Lo hecho hoy cuenta. El resto puede esperar a mañana.",
        "Hoy sumaste. Lo demás puede esperar.",
        "Cierra con calma lo que quieras.",
      ],
    },
    /** Mondays with nothing done: added to the pool (principle 7, a clean slate). */
    mondayNone: [
      "Semana nueva, pizarra limpia.",
      "Lunes: una semana entera por delante, sin deudas.",
    ],
  },

  // ── Día vacío ──
  emptyTitle: "Nada programado para hoy",
  emptyText: "Un día libre. Si quieres, puedes crear un hábito o anotar una tarea.",
  emptyHabits: "Ir a Hábitos",
  emptyTasks: "Ir a Tareas",

  // ── Pagos (F4 de finance) ──
  paymentsTitle: "Pagos",
  paymentsList: "Pagos vencidos y de los próximos 7 días",
  seePayments: "Ver pagos",

  // ── Proyectos (D3) ──
  projectsTitle: "Proyectos",
  projectsList: "Proyectos que vencen pronto o están bloqueados",
  seeProjects: "Ver proyectos",
} as const;
