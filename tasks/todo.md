# Tareas: tasks

> Plan: [`tasks/plan.md`](plan.md) · Spec: [`SPEC-tasks.md`](../SPEC-tasks.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes (verificados antes del merge) y el deploy con smoke test. Commits en inglés (`feat(tasks): …`).
> Tareas anteriores en [`archive/`](archive/).

## Fase 1 — Base

- [ ] **T1: Datos, captura rápida y bandeja**
  - **Qué:** esquema completo (`tasks`, `task_tags`, `task_tag_links`) con `CHECK` e índices; `tasksModule` provisional (Tareas, `/tasks`, atajo 3); captura rápida global (tecla naranja y `C`) con título, área/proyecto y fecha visibles; `/tasks` con la vista Bandeja; completar con un toque y "Deshacer"; borrado lógico; tablas en `pnpm db:export`. El detalle de la tarea queda armado por secciones con puntos de inserción para T2–T4.
  - **Aceptación:** captura en < 10 s en el celular; completar y deshacer; acciones rechazadas sin sesión; `CHECK` probados; axe en 0.
  - **Tamaño:** M

### Checkpoint T1
- [ ] El owner captura desde el celular y completa desde la bandeja.

## Fase 2 — Vistas y reglas *(T2, T3 y T4 en paralelo)*

- [ ] **T2: Vistas y detalle** — Hoy, Próximas, Todas (filtros por área, proyecto y etiqueta), Hechas; detalle con título, notas Markdown, área/proyecto/hito, fecha y prioridad editables.
- [ ] **T3: Recurrencia** — las 5 reglas (cálculo puro en hora de Lima), crear la siguiente al completar en la misma transacción, deshacer borra la creada, editor con resumen legible.
- [ ] **T4: Etiquetas** — crear al escribir, reutilizar, quitar; filtro por etiqueta; etiquetas en la fila.

## Fase 3 — Proyectos y contratos

- [ ] **T5: Tareas en proyectos** — sección "Tareas" en el detalle del proyecto (agrupadas por hito), próxima acción única, `ProgressSource` registrada, fuente de próxima acción para la tarjeta del proyecto ("Siguiente: …"), aviso de tareas abiertas al terminar el proyecto.
- [ ] **T6: Contrato con today y navegación definitiva** — `getTasksTodaySummary(now)`; navegación según el diseño iterado en Claude Design.

### Checkpoint final
- [ ] Recorrido completo en celular y escritorio.
- [ ] Se cumplen los criterios de éxito de `SPEC-tasks.md`.
- [ ] Revisión contigo antes del siguiente módulo.

## Backlog técnico

Deuda y tareas técnicas que cruzan módulos. Se toman cuando haya espacio entre módulos o cuando algo las vuelva urgentes.

- [ ] **LCP con datos reales:** medir el LCP con datos reales (Vercel Speed Insights o Lighthouse con *throttling* real de DevTools) en vez del Lighthouse simulado. Si supera 2,5 s, autoalojar las fuentes recortadas (prototipo: ~0,15 s). Ver "Rendimiento de `/login` (LCP)" en `docs/HANDOFF.md` (cómo medir, hallazgos y siguientes palancas). Origen: criterio de Calidad de `SPEC-core.md`, aceptado por el owner el 2026-10-01.
- [x] **Postgres de pruebas en 18:** CI (`ci.yml`, `update-screenshots.yml` y `backup.yml` con `target=ci-service`) usa `postgres:18.6` fijado por digest, y en local Docker se reemplazó por Postgres 18 nativo (`embedded-postgres`, `pnpm db:test:start`; ver "Pruebas E2E" en `docs/HANDOFF.md`). Hecho en `chore/no-docker-test-db`.
- [ ] **Observabilidad de errores de cliente** (de C8): un error de un componente cliente no tiene `digest` ni llega al registro del servidor; hoy la página no muestra código y nadie se entera. Definir cómo reportarlos (p. ej. un endpoint propio que registre una línea sin el mensaje).
- [ ] **E2E inestable** (de C8): estabilizar la E2E de C6 `e2e/areas-order.spec.ts:329` (⌘Z deshace, escritorio): falló una vez en CI y pasó al reintentar.
