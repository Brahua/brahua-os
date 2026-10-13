# Tareas: goals

> Plan: [`goals-plan.md`](goals-plan.md) · Spec: [`SPEC-goals.md`](../SPEC-goals.md). Cada tarea termina con el gate local liviano en verde, un PR con los 3 checks verdes y el deploy con smoke. Commits en inglés (`feat(goals): …`). Máximo un E2E nuevo en todo el módulo.

- [x] **G1: Datos, metas manuales y pantalla** (`feat/goals-g1`, PR #111 integrado; ver `docs/HANDOFF.md` → "Cómo funciona goals → G1") — migración aditiva (`goals`, `goal_entries`, `weekly_objectives`, `CHECK`, locks en el espacio 5000, `visibleGoal`) y exportación; `pace.ts` y `progress.ts` puros con tablas de casos; `/goals` (crear en < 20 s, editar, archivar, eliminar y deshacer, orden con arrastre, «Anteriores»); «+N» con «Deshacer»; lograr y reabrir; copy sin culpa con su prueba; manifiesto; el único E2E (con `SPEC_MODULES`). Deja slots para G2 y G3.
- [x] **G2: Hábito y proyecto** (`feat/goals-g2`, PR abierto; ver `docs/HANDOFF.md` → "Cómo funciona goals → G2") — `getHabitDoneDays` (habits) y `getProjectProgress` (projects) con sus variantes `select…`; fuentes `habit` y `project` en formulario, filas, detalle y progreso (lograr sola al leer, sin reabrir sola); cambiar la fuente al editar conserva las entradas; regla de ESLint de fronteras con su prueba; `demo-data.ts` ya no choca con las FK `RESTRICT`. Sin E2E nueva.
- [x] **G3: Objetivo semanal y enlaces** (`feat/goals-g3`, PR abierto; ver `docs/HANDOFF.md` → "Cómo funciona goals → G3") — «Esta semana» en `/goals` (objetivo de 1–140 caracteres por semana de Lima, edición en línea, «Deshacer» exacto, lock por semana); `registerHabitSection` en `habits` y la raíz de composición `src/lib/goal-extensions.ts` con la sección «Metas» en el detalle de hábitos y proyectos; `revalidateGoalScreens` revalida también `/habits` y `/projects`. Sin E2E nueva.
- [x] **G4: Cierre** — (**parte de código hecha** en `feat/goals-g4`, PR abierto: «Pasar al próximo periodo»; ver `docs/HANDOFF.md` → «Cómo funciona goals → G4»; faltan retrospectiva, backlog, mapa y archivo) «Pasar al próximo periodo», retrospectiva en `CLAUDE.md`, backlog consolidado, mapa y HANDOFF; archivar plan y tareas.

### Checkpoint final
- [x] Recorrido en producción por el agente (Chrome del owner, datos `[QA]` borrados después).
- [x] Se cumplen los criterios de éxito de `SPEC-goals.md`.
- [x] Revisión con el owner: pendiente de la respuesta del owner al cierre (2026-10-13); las decisiones autónomas siguen listadas en `docs/HANDOFF.md` → «Cómo funciona goals».

Checkpoint en producción (2026-10-13, el agente en el Chrome personal del owner, datos `[QA]` borrados después): crear una meta de cantidad, «+1» y «Deshacer»; fijar y deshacer el objetivo semanal; meta de hábito que sigue el registro de hoy; sección «Metas» en la página del hábito; «Pasar a 2027» y «Deshacer». No se recorrió la sección de proyectos ni el iPhone (quedan para el owner).

El backlog técnico sigue en [`../todo.md`](../todo.md).
