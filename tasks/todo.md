# Tareas: habits

> Plan: [`tasks/plan.md`](plan.md) · Spec: [`SPEC-habits.md`](../SPEC-habits.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes y el deploy con smoke test. Commits en inglés (`feat(habits): …`).
> Tareas anteriores en [`archive/`](archive/).

## Fase 1 — Base

- [x] **H1: Datos, crear y registrar con un toque** — tablas `habits`, `habit_logs`, `habit_pauses` (con `kind`, `CHECK`, índices, locks en el espacio 4000, `visibleHabit`) y exportación; crear un hábito sí/no diario; `/habits` "Hoy" con pads, toque optimista y "Deshacer"; manifiesto provisional; eliminar y deshacer. Deja slots para H2 y H3. *(PR #62 integrado; slots en HANDOFF → "Cómo funciona habits".)*

## Fase 2 — Reglas *(H2 y H3 en paralelo)*

- [x] **H2: Frecuencias y agenda** — X por semana y días fijos; qué toca hoy; "No tocan hoy"; editar; orden manual; archivar y reactivar. *(PR #63 integrado; ver HANDOFF → "Cómo funciona habits" → "H2".)*
- [ ] **H3: Cantidad, varias veces al día y a evitar** — meta, unidad y paso; `target` por día; "Ajustar"; atajo "Varias veces al día"; tipo "A evitar" (recaída). *(En PR, rama `feat/habits-h3-measures`; ver HANDOFF → "Cómo funciona habits" → "H3".)*

## Fase 3 — Rachas e historial

- [ ] **H4: Rachas y pausas** — `streak.ts` con tablas de casos; racha y mejor racha en el pad; pausas; registro y corrección hasta 7 días atrás; hitos de racha.
- [ ] **H5: Historial** — vista Semana con el total ("18 de 24"); detalle con calendario mensual, estadísticas y pausas; "Archivados".
- [ ] **H6: Contrato con today y navegación** — `getHabitsTodaySummary(now)`; `HabitPad` y acciones reutilizables; navegación definitiva cuando llegue el diseño.

### Checkpoint final
- [ ] Recorrido completo en producción (agente con el Chrome del owner) y el iPhone (owner).
- [ ] Se cumplen los criterios de éxito de `SPEC-habits.md`.
- [ ] Revisión con el owner antes del siguiente módulo.

## Backlog técnico

Deuda y tareas técnicas que cruzan módulos. Se toman cuando haya espacio entre módulos o cuando algo las vuelva urgentes.

- [ ] **LCP con datos reales:** medir el LCP con datos reales (Vercel Speed Insights o Lighthouse con *throttling* real de DevTools) en vez del Lighthouse simulado. Si supera 2,5 s, autoalojar las fuentes recortadas (prototipo: ~0,15 s). Ver "Rendimiento de `/login` (LCP)" en `docs/HANDOFF.md` (cómo medir, hallazgos y siguientes palancas). Origen: criterio de Calidad de `SPEC-core.md`, aceptado por el owner el 2026-10-01.
- [x] **Postgres de pruebas en 18:** CI (`ci.yml`, `update-screenshots.yml` y `backup.yml` con `target=ci-service`) usa `postgres:18.6` fijado por digest, y en local Docker se reemplazó por Postgres 18 nativo (`embedded-postgres`, `pnpm db:test:start`; ver "Pruebas E2E" en `docs/HANDOFF.md`). Hecho en `chore/no-docker-test-db`.
- [ ] **Observabilidad de errores de cliente** (de C8): un error de un componente cliente no tiene `digest` ni llega al registro del servidor; hoy la página no muestra código y nadie se entera. Definir cómo reportarlos (p. ej. un endpoint propio que registre una línea sin el mensaje).
- [x] **E2E inestable** (de C8): estabilizar la E2E de C6 `e2e/areas-order.spec.ts:329` (⌘Z deshace, escritorio). Era un error real de la app: el aviso registraba Esc y ⌘Z en un `useEffect`, que corre en una tarea posterior a la que lo pinta; una tecla apretada en ese hueco (el aviso ya en pantalla) se perdía. Ahora es un `useLayoutEffect`, con una prueba unitaria que aprieta la tecla en ese hueco. Hecho en `fix/flaky-areas-order-undo`.
- [ ] **Minutos de CI** (2026-10-02): el plan gratuito da 2.000 min/mes a repos privados y se agotaron en dos días con agentes en paralelo. Antes de volver el repo a privado (~2026-11-01): `paths-ignore` para PRs solo de docs, no lanzar el CI por cada push de un agente (push una vez, con el gate local en verde), menos capturas y medir el consumo por run.
- [x] **Pruebas unitarias intermitentes:** `project-dependencies` y `project-detail` comprobaban la vuelta atrás optimista justo después del aviso (que puede llegar antes); ahora esperan con `waitFor`. Hecho en `fix/flaky-rollback-tests`.
- [ ] **Hitos en proyectos cerrados** (del Checkpoint final de `tasks`): en un proyecto Terminado o Cancelado la sección Tareas no deja agregar, pero Hitos sí deja crear y reordenar. Decidir con el owner si se bloquea también.
- [ ] **Navegación definitiva de Tareas** (T6): espera el diseño del owner en Claude Design; hoy es provisional (atajo 3, barra inferior después de la tecla de captura).
