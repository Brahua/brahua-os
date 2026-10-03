# Tareas: today

> Plan: [`plan.md`](plan.md) · Spec: [`SPEC-today.md`](../SPEC-today.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes y el deploy con smoke test. Commits en inglés (`feat(today): …`).
> Planes y tareas de módulos cerrados en [`archive/`](archive/).

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

- [ ] **D4: Día completo** — `getTasksDoneTodayCount(now)` en `tasks` (con integración, borde de medianoche de Lima); regla pura en `today-board.ts` (con actividad hoy); bloque con mensajes variados, fundido (nada con movimiento reducido) y anuncio único.
  - Verificar: tablas de casos; E2E terminar lo último pendiente muestra el bloque; un día vacío no.
  - Hecho en `feat/today-d4-day-complete` (PR sin merge). Ver "Cómo funciona today" → "D4" en `docs/HANDOFF.md`.

### Checkpoint final
- [ ] Recorrido completo en producción con el Chrome personal del owner (datos `[QA]` borrados después) y revisión en el iPhone.
- [ ] Se cumplen los criterios de éxito de `SPEC-today.md`.
- [ ] Revisión con el owner: cierre del módulo y decisiones autónomas.

## Backlog técnico

Deuda y tareas técnicas que cruzan módulos. Se toman cuando haya espacio entre módulos o cuando algo las vuelva urgentes.

- [ ] **LCP con datos reales:** medir el LCP con datos reales (Vercel Speed Insights o Lighthouse con *throttling* real de DevTools) en vez del Lighthouse simulado. Si supera 2,5 s, autoalojar las fuentes recortadas (prototipo: ~0,15 s). Ver "Rendimiento de `/login` (LCP)" en `docs/HANDOFF.md` (cómo medir, hallazgos y siguientes palancas). Origen: criterio de Calidad de `SPEC-core.md`, aceptado por el owner el 2026-10-01.
- [x] **Postgres de pruebas en 18:** CI (`ci.yml`, `update-screenshots.yml` y `backup.yml` con `target=ci-service`) usa `postgres:18.6` fijado por digest, y en local Docker se reemplazó por Postgres 18 nativo (`embedded-postgres`, `pnpm db:test:start`; ver "Pruebas E2E" en `docs/HANDOFF.md`). Hecho en `chore/no-docker-test-db`.
- [ ] **Observabilidad de errores de cliente** (de C8): un error de un componente cliente no tiene `digest` ni llega al registro del servidor; hoy la página no muestra código y nadie se entera. Definir cómo reportarlos (p. ej. un endpoint propio que registre una línea sin el mensaje).
- [x] **E2E inestable** (de C8): estabilizar la E2E de C6 `e2e/areas-order.spec.ts:329` (⌘Z deshace, escritorio). Era un error real de la app: el aviso registraba Esc y ⌘Z en un `useEffect`, que corre en una tarea posterior a la que lo pinta; una tecla apretada en ese hueco (el aviso ya en pantalla) se perdía. Ahora es un `useLayoutEffect`, con una prueba unitaria que aprieta la tecla en ese hueco. Hecho en `fix/flaky-areas-order-undo`.
- [ ] **Minutos de CI** (2026-10-02): el plan gratuito da 2.000 min/mes a repos privados y se agotaron en dos días con agentes en paralelo. Antes de volver el repo a privado (~2026-11-01): `paths-ignore` para PRs solo de docs, no lanzar el CI por cada push de un agente (push una vez, con el gate local en verde), menos capturas y medir el consumo por run.
- [x] **Pruebas unitarias intermitentes:** `project-dependencies` y `project-detail` comprobaban la vuelta atrás optimista justo después del aviso (que puede llegar antes); ahora esperan con `waitFor`. Hecho en `fix/flaky-rollback-tests`.
- [ ] **Hitos en proyectos cerrados** (del Checkpoint final de `tasks`): en un proyecto Terminado o Cancelado la sección Tareas no deja agregar, pero Hitos sí deja crear y reordenar. Decidir con el owner si se bloquea también.
- [ ] **"Archivados" más liviano** (de H5): la sección en "Semana" lee cada hábito archivado como `HabitItem` (con todos sus registros marcados para las rachas) aunque solo muestra nombre, área y "Reactivar". Con muchos archivados, una consulta propia (id, nombre, área).
- [ ] **Navegación definitiva de Tareas** (T6): espera el diseño del owner en Claude Design; hoy es provisional (atajo 3, barra inferior después de la tecla de captura).
- [ ] **Navegación definitiva de Hábitos** (H6): espera el diseño del owner en Claude Design, como la de Tareas; hoy es la provisional de H1 (atajo 4, la celda después de la tecla de captura en la barra inferior, Tareas en "Más").
- [ ] **Archivados de hábitos** (de H5): la lista lee cada hábito archivado completo, con su historial; si crecen, una consulta más liviana.
- [ ] **`DayCell` en Claude Design** (de H5): los estados "pasado sin cumplir", "parcial" y "no cuenta" del calendario de hábitos viven en `overrides.css` (`PENDING UPSTREAM`); aplicarlos en Claude Design y vaciar el override.
- [ ] **Calendario de hábitos a 320 px** (de H5): cada día mide ~39 px (cumple WCAG AA, no los 44 px del principio 14). Revisarlo con el diseño.
- [ ] **Hook único de pads de hábitos** (de D1): que `habits` exporte `useHabitPadsLog` (o un componente cliente que dibuje la grilla de pads con su registro) y `today` deje de importar `habit-list-optimistic`, `habits-copy` y `useHabitsScreen`, como `tasks` hizo en D2 con `taskCompletion` y `TaskTodayRow`.
- [ ] **Áreas y la portada** (de D2): renombrar, cambiar el color o archivar un área (`core`) no revalida `/`; las tareas (y los hábitos) de la portada muestran el área vieja hasta la siguiente lectura. `core` no puede importar a `today`: que `core` revalide `/` directamente al cambiar un área.
- [ ] **Confeti en hitos de racha** (de H4): sin `canvas-confetti` (dependencia nueva, pide OK del owner); hoy solo texto.
