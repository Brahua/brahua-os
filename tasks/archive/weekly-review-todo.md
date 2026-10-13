# Tareas: weekly-review

> Plan: [`weekly-review-plan.md`](weekly-review-plan.md) · Spec: [`SPEC-weekly-review.md`](../SPEC-weekly-review.md). Cada tarea termina con el gate local liviano en verde, un PR con los 3 checks verdes y el deploy con smoke. Commits en inglés (`feat(weekly-review): …`). Máximo un E2E nuevo en todo el módulo.

- [x] **W1: Datos y contratos** (`feat/weekly-review-w1`; ver `docs/HANDOFF.md` → «Cómo funciona weekly-review → W1») — migración aditiva `weekly_reviews` (`CHECK`, lock en el espacio 6000) y exportación; `week.ts` puro (semana a revisar, ventana de la invitación); `getHabitsWeekCompleteDays`; `getTasksWeekReview` y `moveTasksToDate`/`undoMoveTasks`; `getProjectsWeekReview`; `getGoalsWeekReview` y el objetivo semanal por contrato; regla de ESLint de fronteras. Sin pantalla.
- [x] **W2: Pasos 1 y 2** (`feat/weekly-review-w2`; ver `docs/HANDOFF.md` → «Cómo funciona weekly-review → W2») — `/review` con Logros y Pendientes (lote y por fila, «Deshacer» exacto); módulo «Revisión» en la navegación (sin atajo). Sin E2E nueva.
- [x] **W3: Pasos 3 y 4, cierre y registro** (`feat/weekly-review-w3`; ver `docs/HANDOFF.md` → «Cómo funciona weekly-review → W3») — Metas y proyectos, Próxima semana (objetivo y nota), «Cerrar la semana» idempotente, pantalla de cierre, «Semanas anteriores». El único E2E del módulo (con `SPEC_MODULES` y `@today-*`).
- [x] **W4: Invitación y cierre** — _(mitad de código hecha en `feat/weekly-review-w4`: `getReviewInvite`, `ReviewInviteCard`, raíz `src/lib/review-extensions.tsx`, revalidación al cerrar, sin E2E nueva; faltan retrospectiva, backlog, mapa, archivo y Checkpoint, del orquestador)_ `getReviewInvite` y `ReviewInviteCard` en `/` y `/goals` (raíz `src/lib/review-extensions.ts`), retrospectiva en `CLAUDE.md`, backlog, mapa y HANDOFF; archivar plan y tareas.

### Checkpoint final
- [x] Recorrido en producción por el agente (Chrome del owner, datos `[QA]` borrados después).
- [x] Se cumplen los criterios de éxito de `SPEC-weekly-review.md`.
- [x] Revisión con el owner: pendiente de su respuesta al cierre (2026-10-14); las decisiones autónomas siguen listadas en `docs/HANDOFF.md` → «Cómo funciona weekly-review».

Checkpoint en producción (2026-10-14, el agente en el Chrome personal del owner): los cuatro pasos de `/review` cargan con sus vacíos amables (semana por defecto = la anterior, por ser martes), cerrar una semana vieja (28 sep–4 oct) con una nota `[QA]` muestra la pantalla de cierre y la deja en «Semanas anteriores», y `/` y `/goals` cargan con el hueco de la tarjeta. **No se pudo ver la tarjeta de invitación** (solo existe del domingo 18:00 al lunes 23:59 Lima) ni los pasos con datos reales (la base de producción está vacía de hábitos, tareas y proyectos). **Queda una fila `weekly_reviews` de prueba** (semana 2026-09-28, nota `[QA] prueba del Checkpoint, se puede ignorar`): la revisión no tiene borrado en v1; se quita con un script de datos de producción cuando el owner lo apruebe.

El backlog técnico sigue en [`../todo.md`](../todo.md).
