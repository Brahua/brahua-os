# Tareas: finance

> Plan: [`finance-plan.md`](finance-plan.md) · Spec: [`SPEC-finance.md`](../../SPEC-finance.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con los 3 checks verdes y el deploy con smoke test. Commits en inglés (`feat(finance): …`).

## Fase 1 — Base

- [x] **F1: Datos y gastos sueltos** — Integrado en PR #78 — migración con las seis tablas (`CHECK`, índices), locks `FINANCE_ADVISORY_SPACE = 5000`, exportación; `money.ts`; catálogo (categorías y medios: crear, renombrar, ordenar, archivar) y tipo de cambio en la hoja "Ajustes"; `/finance` → Mes con la lista de gastos del mes; hoja "Gasto" (crear, editar, eliminar con "Deshacer"); captura rápida con selector "Tarea · Gasto"; manifiesto "Finanzas" (atajo 5) y regla de límites. Slots para Pagos, resumen y "Pendiente de pagar".
  - Verificar: unitarias de `money.ts` y Zod; integración de `CHECK`, catálogo con lock y tipo de cambio guardado; E2E capturar un gasto en ≤ 3 interacciones (celular), editar, eliminar y deshacer, captura de tareas intacta, axe en ambos temas, 320 px.

## Fase 2 — Recurrentes y resumen *(F2 y F3 en paralelo)*

- [x] **F2: Pagos recurrentes** — Integrado en PR #79 — `schedule.ts` (cuatro ciclos, pendientes con ventana de 60 días); crear, editar, archivar, reactivar, eliminar; pestaña Pagos (pendientes, este mes, todos, archivados); "Pagado" (un toque o la hoja si es variable), "Pagado…", omitir y deshacer; página `/finance/payments/[id]` con historial.
  - Verificar: tablas de casos de `schedule.ts`; integración de pagar dos veces a la vez (un solo gasto), omitir, deshacer y eliminar el gasto pagado; E2E pagar, pago variable, omitir.
- [x] **F3: Resumen mensual** — Integrado en PR #80 — `summary.ts`; total en PEN (`NumberFlow`), barras por categoría (filtran la lista), por medio, recurrente vs suelto, USD sin convertir, "Pendiente de pagar"; navegación de meses.
  - Verificar: tablas de casos de `summary.ts`; E2E resumen con un gasto en USD y navegación de meses; barras accesibles.

## Fase 3 — Portada e importación

- [x] **F4: Pagos en la portada** (Integrado en PR #82) — `getFinanceTodaySummary(now)`; sección "Pagos" en `today` entre Tareas y Proyectos con "Pagado"; "Día completo" con pagos vencidos o de hoy; `finance` revalida `/`.
  - Verificar: integración del contrato (número fijo de consultas, autorización); tablas de casos de `today-board.ts`; E2E pagar desde `/` y deshacer.
- [x] **F5: Importación desde Notion** — Integrado en PR #81; importación en producción hecha el 2026-10-05 — lectura con el MCP a un JSON fuera del repo; `scripts/finance-import.ts` (`pnpm db:finance:import`), ids deterministas, idempotente, confirmación y respaldo; corrida en producción.
  - Verificar: integración contra la base desechable con un JSON ficticio (mapeo, archivados, variable, idempotencia); en producción, 33 recurrentes, 13 categorías y 9 medios, sin vencidos el primer día.
  - Script y pruebas: PR de `feat/finance-f5`, sin merge. Pendiente: lectura de Notion al JSON (fuera del repo) y corrida en producción (paso aparte del orquestador).

### Checkpoint final
- [x] Recorrido completo en producción (2026-10-05, ~23:30 Lima): el agente lo hizo en el Chrome personal del owner. Captura rápida "Gasto" (`[QA] Café` 12,50 con coma, "Registrado…" + "Deshacer", resumen al instante), pestaña Pagos (Pendientes jue 8 / lun 12 con "Pagado" discreto, "Este mes", "Todos" con los 16 activos, "Archivados (17)"), pagar Netflix y "Deshacer" (vuelve a pendiente), "Pendiente de pagar: 13 pagos, S/ 8,226.00" (cuadra con los vencimientos de octubre importados), portada con "Pagos" entre Tareas y Proyectos (3 filas). Gasto `[QA]` eliminado. El ancho de celular, el tema claro y axe quedan cubiertos por las E2E. Visto: el primer clic en "Pagos" justo tras cerrar la hoja de captura no cambió de pestaña (mismo síntoma que "Clic perdido tras eliminar" del backlog).
- [x] Se cumplen los criterios de éxito de `SPEC-finance.md` (criterio 1: 4 interacciones la primera vez en un dispositivo, 3 después; decisión para revisar con el owner).
- [x] Revisión con el owner: cerró el módulo el 2026-10-06 y aceptó todas las decisiones autónomas (tabla "Autónomas" de la spec y secciones F1–F5 de "Cómo funciona finance" en HANDOFF).

El backlog técnico sigue en [`../todo.md`](../todo.md).
