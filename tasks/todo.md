# Tareas

> Módulo en curso: **`finance`** · Plan: [`plan.md`](plan.md) · Spec: [`SPEC-finance.md`](../SPEC-finance.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes y el deploy con smoke test. Commits en inglés (`feat(finance): …`).
> Planes y tareas de módulos cerrados en [`archive/`](archive/).

## Fase 1 — Base

- [ ] **F1: Datos y gastos sueltos** — migración con las seis tablas (`CHECK`, índices), locks `FINANCE_ADVISORY_SPACE = 5000`, exportación; `money.ts`; catálogo (categorías y medios: crear, renombrar, ordenar, archivar) y tipo de cambio en la hoja "Ajustes"; `/finance` → Mes con la lista de gastos del mes; hoja "Gasto" (crear, editar, eliminar con "Deshacer"); captura rápida con selector "Tarea · Gasto"; manifiesto "Finanzas" (atajo 5) y regla de límites. Slots para Pagos, resumen y "Pendiente de pagar".
  - Verificar: unitarias de `money.ts` y Zod; integración de `CHECK`, catálogo con lock y tipo de cambio guardado; E2E capturar un gasto en ≤ 3 interacciones (celular), editar, eliminar y deshacer, captura de tareas intacta, axe en ambos temas, 320 px.

## Fase 2 — Recurrentes y resumen *(F2 y F3 en paralelo)*

- [ ] **F2: Pagos recurrentes** — `schedule.ts` (cuatro ciclos, pendientes con ventana de 60 días); crear, editar, archivar, reactivar, eliminar; pestaña Pagos (pendientes, este mes, todos, archivados); "Pagado" (un toque o la hoja si es variable), "Pagado…", omitir y deshacer; página `/finance/payments/[id]` con historial.
  - Verificar: tablas de casos de `schedule.ts`; integración de pagar dos veces a la vez (un solo gasto), omitir, deshacer y eliminar el gasto pagado; E2E pagar, pago variable, omitir.
- [ ] **F3: Resumen mensual** — `summary.ts`; total en PEN (`NumberFlow`), barras por categoría (filtran la lista), por medio, recurrente vs suelto, USD sin convertir, "Pendiente de pagar"; navegación de meses.
  - Verificar: tablas de casos de `summary.ts`; E2E resumen con un gasto en USD y navegación de meses; barras accesibles.

## Fase 3 — Portada e importación

- [ ] **F4: Pagos en la portada** — `getFinanceTodaySummary(now)`; sección "Pagos" en `today` entre Tareas y Proyectos con "Pagado"; "Día completo" con pagos vencidos o de hoy; `finance` revalida `/`.
  - Verificar: integración del contrato (número fijo de consultas, autorización); tablas de casos de `today-board.ts`; E2E pagar desde `/` y deshacer.
- [ ] **F5: Importación desde Notion** — lectura con el MCP a un JSON fuera del repo; `scripts/finance-import.ts` (`pnpm db:finance:import`), ids deterministas, idempotente, confirmación y respaldo; corrida en producción.
  - Verificar: integración contra la base desechable con un JSON ficticio (mapeo, archivados, variable, idempotencia); en producción, 33 recurrentes, 13 categorías y 9 medios, sin vencidos el primer día.

### Checkpoint final
- [ ] Recorrido completo en producción con el Chrome personal del owner (datos `[QA]` borrados después).
- [ ] Se cumplen los criterios de éxito de `SPEC-finance.md`.
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
- [ ] **Clic perdido tras eliminar** (del Checkpoint final de `today`, 2026-10-03): justo después de eliminar una tarea o un hábito (aviso con "Deshacer" en pantalla), el primer clic en la página no hace nada y el segundo sí. Pasa en Tareas y en Hábitos. Reproducir con una E2E y corregir (¿foco o capa del visor de avisos?).
- [ ] **Grilla de hábitos que salta en el iPhone** (de D4): al cumplirse un hábito de cantidad su tarjeta crece y "Día completo" aparece arriba y empuja la grilla bajo el dedo. Si molesta en el uso diario: reservar alto o no empujar en vivo (opciones en HANDOFF → D4).
- [ ] **E2E intermitente "Hito"** (`e2e/task-views.spec.ts`, escritorio; visto en local durante D4): tras elegir "Sin hito", `milestoneId` no vuelve a `null` en 5 s en corridas conjuntas. Estabilizar.
- [ ] **Datos de demo que envejecen:** las fechas se calculan el día en que se cargan (2026-10-03). Para refrescarlas: `pnpm db:demo:remove` y `pnpm db:demo` (ver HANDOFF → "Datos de demo"). Quitarlos antes de usar la app con datos reales.
