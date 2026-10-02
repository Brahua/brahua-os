# Tareas: tasks

> Plan: [`tasks-plan.md`](tasks-plan.md) · Spec: [`SPEC-tasks.md`](../SPEC-tasks.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes (verificados antes del merge) y el deploy con smoke test. Commits en inglés (`feat(tasks): …`).
> Tareas anteriores en [`archive/`](archive/).

## Fase 1 — Base

- [x] **T1: Datos, captura rápida y bandeja** — PR #49 integrado. Detalle y puntos de extensión para T2–T4 en `docs/HANDOFF.md` → "Cómo funciona tasks".
  - **Qué:** esquema completo (`tasks`, `task_tags`, `task_tag_links`) con `CHECK` e índices; `tasksModule` provisional (Tareas, `/tasks`, atajo 3); captura rápida global (tecla naranja y `C`) con título, área/proyecto y fecha visibles; `/tasks` con la vista Bandeja; completar con un toque y "Deshacer"; borrado lógico; tablas en `pnpm db:export`. El detalle de la tarea queda armado por secciones con puntos de inserción para T2–T4.
  - **Aceptación:** captura en < 10 s en el celular; completar y deshacer; acciones rechazadas sin sesión; `CHECK` probados; axe en 0.
  - **Tamaño:** M

### Checkpoint T1
- [x] Omitido a pedido del owner: cubierto por el Checkpoint final.

## Fase 2 — Vistas y reglas *(T2, T3 y T4 en paralelo)*

- [x] **T2: Vistas y detalle** — Hoy, Próximas, Todas (filtros por área, proyecto y etiqueta), Hechas; detalle con título, notas Markdown, área/proyecto/hito, fecha y prioridad editables. PR #53 integrado; el filtro por etiqueta queda como slot para T4. Detalle en `docs/HANDOFF.md` → "T2: vistas y detalle".
- [x] **T3: Recurrencia** — las 5 reglas (cálculo puro en hora de Lima), crear la siguiente al completar en la misma transacción, deshacer borra la creada, editor con resumen legible. PR #52 integrado.
- [x] **T4: Etiquetas** — crear al escribir, reutilizar, quitar; filtro por etiqueta; etiquetas en la fila. PR #51 integrado. Ver "T4: etiquetas" en `docs/HANDOFF.md`.
  - Seguimiento: renombrar y eliminar etiquetas de forma global; limpiar las sin uso.

## Fase 3 — Proyectos y contratos

- [x] **T5: Tareas en proyectos** — sección "Tareas" en el detalle del proyecto (agrupadas por hito), próxima acción única, `ProgressSource` registrada, fuente de próxima acción para la tarjeta del proyecto ("Siguiente: …"), aviso de tareas abiertas al terminar el proyecto. PR #54 integrado. Detalle y decisiones para revisar en `docs/HANDOFF.md` → "T5: tareas en proyectos".
- [ ] **T6: Contrato con today y navegación definitiva** — [x] `getTasksTodaySummary(now)` (PR #55 integrado); [ ] navegación según el diseño iterado en Claude Design (espera al owner).

### Checkpoint final
- [x] Recorrido completo en producción (2026-10-02): el agente lo hizo en el Chrome del owner (escritorio, ancho de celular, ambos temas) y el owner lo dio por cerrado. El iPhone real queda para el owner.
- [x] Se cumplen los criterios de éxito de `SPEC-tasks.md`.
- [x] Revisión con el owner: aceptó las decisiones autónomas listadas en HANDOFF.

El backlog técnico sigue en [`../todo.md`](../todo.md).
