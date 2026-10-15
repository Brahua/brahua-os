# Plan de implementación: finance-motion

> Spec: [`SPEC-finance-motion.md`](../../SPEC-finance-motion.md) (APROBADO v1.0, 2026-10-14) · Tareas: [`finance-motion-todo.md`](finance-motion-todo.md) → «Módulo `finance-motion`» · Diseño: Claude Design, proyecto `3787b11d-b9b0-4ea2-bd5d-26d0f072f863` (`Finanzas.dc.html`)
> Plan archivado el 2026-10-15 (módulo cerrado).

## Enfoque

Rebanadas verticales, **un implementador a la vez** (gate local liviano; integración de a un archivo nuevo): rama corta → PR a `main` → los 3 checks verdes verificados antes de cada merge → deploy y smoke. Cada agente hace push **una vez**. Cada corte añade **como máximo una** spec E2E (solo M5). Antes de escribir código se lee la guía de Next en `node_modules/next/dist/docs/`, y el diseño se vuelve a leer por MCP (`DesignSync`: `list_files`/`get_file`) por si el owner lo cambió.

## Orden y dependencias

```
M1 Contrato y movimiento base ─> M2 Estructura nueva ─┬─> M3 Color de categorías ─┐
                                                      └─> M4 Gráfico de ritmo ────┴─> M5 Acciones con vida + E2E + cierre
```

- **M1** `src/lib/motion` (tokens espejados con test de deriva, `MotionProvider`, variantes con versión reducida, test-utils y documentación del contrato); aplica sobre lo existente: cascada de entrada, `NumberFlow` en categorías/medios/pendiente/%, barras que crecen, cambio de mes direccional, crossfade. Sin cambiar estructura ni datos.
- **M2** control de 4 secciones con cookie compatible (`mes`/`pagos` antiguos), cabecera con delta y «Día n de m», tarjetas `MetricCard` (*Gastado*, *Pendiente de pagar* con próxima fecha), barra apilada (`StackedBar`) + lista, tarjeta única de medios y recurrente/suelto, total por día en Gastos. `trend.ts` y `getMonthlyTotals`. Deja los **slots y contratos** para M3 (`categoryColor(slot)`), M4 (`<RhythmChart/>` y sparkline) y M5.
- **M3** migración aditiva `color_slot`, backfill por orden, asignación del primer slot libre al crear, `--cat-1…8` en `overrides.css` (`PENDING UPSTREAM`), punto/segmento/línea de 2 px.
- **M4** `AreaChart` SVG (línea con `drawPath`, punteada del mes anterior, «hoy», tooltip por cursor/toque/← →), sparkline de 6 meses, `getPreviousMonthCumulative`.
- **M5** `FilterChip` y salida/entrada de filas (`AnimatePresence` + `layout`), registrar/borrar/«Deshacer» animados sin tocar sus reglas, celebración de «Pagado» tras el éxito de la acción, la **única E2E** (`e2e/finance-motion.spec.ts` + `SPEC_MODULES`), capturas, medición de JS añadido, Checkpoint en producción, retrospectiva, mapa, HANDOFF y archivo.

M3 y M4 son independientes tras M2 (contrato fijado); por la regla de un implementador a la vez van en secuencia y se mergea lo que quede verde primero.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Animaciones que flakean la E2E o las capturas | `reducedMotion: "reduce"` en la spec de Playwright, `afterSaveSettled`, estado final determinista; capturas con `update-screenshots.yml` justo tras el push. |
| Foco perdido al desmontar con `AnimatePresence` | Devolver el foco explícitamente (lección de `core`), pruebas de foco por cada salida animada. |
| Motion en jsdom (temporizadores, `matchMedia`, SVG) | Test-utils compartido (patrón de `swipe-row`); limpiar timers al desmontar (lección de `tasks`). |
| Peso de JS en `/finance` | `LazyMotion` con carga dinámica, `domAnimation` por defecto y `domMax` solo con `layout`; medir en CI (meta ≤ 25 kB gz). |
| Dinero: el gráfico o el delta no cuadran con el resumen | `trend.ts` puro reutiliza `summarizeMonth`; una prueba compara ambos; USD sin convertir excluido con nota visible. |
| Cambio de estructura rompe cookie, E2E o enlaces (`?month=`, «Pendiente de pagar» → Pagos) | Cookie compatible con valores antiguos; revisar `e2e/finance*.spec.ts`, `home.spec.ts` y helpers `e2e/support/*`; mapa de qué specs corre cada PR (`SPEC_MODULES`). |
| Migración `color_slot` | Aditiva, `NULL` permitido, backfill idempotente; correr la migración en integración antes de confiar; Prettier sobre el snapshot. |
| «Pagado» celebra sin que el pago se haya guardado | Gancho solo en el éxito del `enqueue`; prueba con fallo (no celebra) y con deshacer. |
| Repo público con datos reales | Fixtures y capturas con datos inventados; el diseño usa datos de ejemplo. |
| Midnight de Lima en pruebas de fechas | Reloj fijo en las pruebas de «Día n de m» y del punto del mes. |

## Checkpoints

- **Tras M1:** `/finance` anima como hoy pero con Motion y reducido correcto; test de deriva de tokens verde.
- **Tras M2:** los números coinciden con `summarizeMonth` y las 4 secciones se recuerdan en la cookie; el owner revisa la estructura en producción.
- **Tras M4:** el gráfico coincide con los gastos reales de dos meses (comparación manual del agente con el Chrome del owner).
- **Checkpoint final (M5):** el agente recorre en producción cada interacción del diseño (datos `[QA]` que luego se borran); el owner confirma fluidez en el iPhone (táctil, gráfico, celebración).
