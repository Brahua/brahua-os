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

  // ── Día vacío ──
  emptyTitle: "Nada programado para hoy",
  emptyText: "Un día libre. Si quieres, puedes crear un hábito o anotar una tarea.",
  emptyHabits: "Ir a Hábitos",
  emptyTasks: "Ir a Tareas",

  // ── Proyectos (D3) ──
  projectsTitle: "Proyectos",
  projectsList: "Proyectos que vencen pronto o están bloqueados",
  seeProjects: "Ver proyectos",
} as const;
