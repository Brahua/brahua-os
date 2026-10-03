# Tareas: habits

> Plan: [`habits-plan.md`](habits-plan.md) · Spec: [`SPEC-habits.md`](../SPEC-habits.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes y el deploy con smoke test. Commits en inglés (`feat(habits): …`).
> Tareas anteriores en [`archive/`](archive/).

## Fase 1 — Base

- [x] **H1: Datos, crear y registrar con un toque** — tablas `habits`, `habit_logs`, `habit_pauses` (con `kind`, `CHECK`, índices, locks en el espacio 4000, `visibleHabit`) y exportación; crear un hábito sí/no diario; `/habits` "Hoy" con pads, toque optimista y "Deshacer"; manifiesto provisional; eliminar y deshacer. Deja slots para H2 y H3. *(PR #62 integrado; slots en HANDOFF → "Cómo funciona habits".)*

## Fase 2 — Reglas *(H2 y H3 en paralelo)*

- [x] **H2: Frecuencias y agenda** — X por semana y días fijos; qué toca hoy; "No tocan hoy"; editar; orden manual; archivar y reactivar. *(PR #63 integrado; ver HANDOFF → "Cómo funciona habits" → "H2".)*
- [x] **H3: Cantidad, varias veces al día y a evitar** — meta, unidad y paso; `target` por día; "Ajustar"; atajo "Varias veces al día"; tipo "A evitar" (recaída). *(PR #64 integrado; ver HANDOFF → "Cómo funciona habits" → "H3".)*

## Fase 3 — Rachas e historial

- [x] **H4: Rachas y pausas** — `streak.ts` con tablas de casos; racha en el pad (la mejor, en el detalle de H5); pausas; registro y corrección hasta 7 días atrás; hitos de racha. *(PR #66 integrado; ver HANDOFF → "Cómo funciona habits" → "H4".)*
- [x] **H5: Historial** — vista Semana con el total ("18 de 24"); detalle con calendario mensual, estadísticas y pausas; "Archivados"; "Más detalles" (identidad, momento, fecha de inicio). *(PR #67 integrado; ver HANDOFF → "Cómo funciona habits" → "H5".)*
- [x] **H6: Contrato con today y navegación** — `getHabitsTodaySummary(now)`; `HabitPad` y acciones reutilizables; navegación definitiva cuando llegue el diseño. *(PR #68 integrado, con `getHabitsWeekSummary` para `weekly-review` y el hook `useDayLog`; ver HANDOFF → "Cómo funciona habits" → "H6". **La navegación definitiva sigue esperando el diseño del owner en Claude Design**: queda la provisional de H1, anotada en el backlog técnico.)*

### Checkpoint final
- [x] Recorrido completo en producción (2026-10-02): el agente lo hizo en el Chrome personal del owner (crear, un toque, ⌘Z, cantidad, a evitar, pausar y reanudar, Semana, página del hábito, eliminar; datos `[QA]` borrados). El ancho de celular quedó cubierto por las E2E (la ventana no se dejó achicar) y el iPhone real queda para el owner.
- [x] Se cumplen los criterios de éxito de `SPEC-habits.md`.
- [x] Revisión con el owner: cerró el módulo el 2026-10-02 y aceptó las decisiones autónomas anotadas en HANDOFF.

El backlog técnico sigue en [`../todo.md`](../todo.md).
