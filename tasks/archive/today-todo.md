# Tareas: today

> Plan: [`today-plan.md`](today-plan.md) · Spec: [`SPEC-today.md`](../../SPEC-today.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes y el deploy con smoke test. Commits en inglés (`feat(today): …`).
> Tareas anteriores en este mismo directorio.

## Fase 1 — Base

- [x] **D1: Tablero con hábitos** — módulo `src/modules/today/` (manifiesto "Hoy" desde `core`, regla de límites: nadie importa `today`); portada `/` con cabecera, sección Hábitos ("X de N", pads con registro y "Deshacer" vía `getHabitsDueToday` y los servicios del anfitrión) y día vacío; `TodayBoard` con slots para Tareas, Proyectos y Día completo.
  - Verificar: unitarias de secciones ocultas y día vacío; E2E registrar y deshacer desde `/` (celular y escritorio), axe en ambos temas, 320 px.
  - Integrado en PR #71. Ver "Cómo funciona today" → "D1" en `docs/HANDOFF.md`.

## Fase 2 — Secciones *(D2 y D3 en paralelo)*

- [x] **D2: Tareas** — sección con `getTasksTodaySummary`, 3 visibles y "Ver N más"/"Ver menos", casilla para completar (con `completeTaskWithNext` y el aviso de la siguiente), foco restaurado al salir la fila, enlace a la tarea; `tasks` revalida `/`.
  - Verificar: unitarias del tope y del foco; E2E completar y deshacer, recurrente, plegado.
  - Integrado en PR #72. Ver "Cómo funciona today" → "D2" en `docs/HANDOFF.md`.
- [x] **D3: Proyectos** — sección de solo lectura con `getProjectsTodaySummary` (LED, vencimiento, "Bloqueado por …", enlace); `projects` revalida `/`.
  - Verificar: unitarias de las filas; E2E con un proyecto que vence y uno bloqueado.
  - Integrado en PR #73. Ver "Cómo funciona today" → "D3" en `docs/HANDOFF.md`.

## Fase 3 — Cierre

- [x] **D4: Día completo** — `getTasksDoneTodayCount(now)` en `tasks` (con integración, borde de medianoche de Lima); regla pura en `today-board.ts` (con actividad hoy); bloque con mensajes variados, fundido (nada con movimiento reducido) y anuncio único.
  - Verificar: tablas de casos; E2E terminar lo último pendiente muestra el bloque; un día vacío no.
  - Integrado en PR #74. Ver "Cómo funciona today" → "D4" en `docs/HANDOFF.md`.

### Checkpoint final
- [x] Recorrido completo en producción (2026-10-03): el agente lo hizo en el Chrome personal del owner (día vacío real, hábitos con toque/cantidad/"Deshacer", 5 tareas con captura rápida y plegado, completar y deshacer, proyecto que vence, "Día completo" en vivo y al recargar, tema claro; datos `[QA]` borrados). El ancho de celular quedó cubierto por las E2E (la ventana no se dejó achicar); el owner revisó la app con los datos de demo (2026-10-05).
- [x] Se cumplen los criterios de éxito de `SPEC-today.md`.
- [x] Revisión con el owner: cerró el módulo el 2026-10-05 y aceptó todas las decisiones autónomas anotadas en HANDOFF ("Cómo funciona today").

El backlog técnico sigue en [`../todo.md`](../todo.md).
