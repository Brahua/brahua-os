# Tareas: health

> Plan: [`health-plan.md`](health-plan.md) · Spec: [`SPEC-health.md`](../../SPEC-health.md) (aprobada el 2026-11-04). **Cerrado el 2026-11-05.**

Cada tarea terminó con el gate local liviano en verde, revisión del commit local, un push, un PR con los 3 checks verdes y el deploy con smoke. Un solo E2E nuevo en todo el módulo (E4).

- [x] **E1: Catálogo y rutinas** (M; `feat/health-e1`) — en producción (#178)
  - Migración aditiva `0029`: `health_exercises` (semilla de 64 por `seed_key`, ids `md5`, `ON CONFLICT DO NOTHING`; único parcial por `name_key`), `health_routines`, `health_routine_exercises`, `health_settings` (una fila, FK a `habits`); Prettier sobre el snapshot; `EXPORTABLE_TABLES`.
  - `src/modules/health/`: `module.ts` («Entreno», `navOrder` 70, `Dumbbell`), `routes.ts`, `lock-keys.ts` (`HEALTH_ADVISORY_SPACE = 10000`), `seed.ts`, `exercises-*.ts`, `routines-*.ts`, copy, `export.ts`, `components/`; páginas `/health`, `/health/exercises`, `/health/exercises/[id]`, `/health/routines/[id]` con `requireOwner()`.
  - Regla de ESLint `HEALTH_ONLY_CONTRACTS` (nadie importa `health` salvo `today` y `weekly-review`; `health` solo `habits/contracts` y `routes`) y la excepción de un archivo para la FK.
  - **Aceptación:** los 64 ejercicios existen tras migrar (dos veces = 64); «Nuevo ejercicio» rechaza un nombre repetido sin acentos; una rutina con 5 ejercicios se arma y reordena con teclado y toque; borrar tiene «Deshacer».
  - **Verificación:** unitarias (clave de nombre, Zod de rutina, copy sin cadenas prohibidas, componentes); integración de a un archivo (`tests/integration/health-catalog.test.ts`: `CHECK` crudos, semilla idempotente, unicidad, orden con lock, autorización, exportación); tras el push, `e2e/home.spec.ts` y dispatch de `update-screenshots.yml`. Sin E2E nueva.
- [x] **E2: Sesión** (L; `feat/health-e2`) — en producción (#179)
  - Migración `0030`: `health_sessions` (único parcial de la abierta), `health_session_exercises`, `health_sets`.
  - Empezar (rutina o libre; lock primero), precarga por posición, serie (peso ↔ gramos, reps, segundos, distancia, calentamiento, casilla), añadir/quitar con «Deshacer», reordenar, nota, barra de descanso, terminar/descartar (4 h, «Deshacer» exacto), `/health/sessions` y `/health/sessions/[id]` (terminadas editables), `useSecondClock` a `src/lib`.
  - **Aceptación:** nunca dos sesiones abiertas; una serie marcada sobrevive a recargar; «Terminar» quita las planificadas y su «Deshacer» las devuelve.
  - **Verificación:** unitarias (peso, precarga, 4 h, descanso, componentes); integración (`health-sessions.test.ts`: concurrencia con control positivo, terminar y deshacer, autorización); dispatch de `update-screenshots.yml` si cambian capturas. Sin E2E nueva.
- [x] **E3: Récords e historial** (M; `feat/health-e3`) — en producción (#180)
  - `records.ts` (por tipo, Epley 1–12, nuevos estrictos), resumen al terminar con `celebrate`, detalle del ejercicio (récords, línea SVG + tabla, historial de 20 en 20), récords en las filas de sesiones.
  - **Aceptación:** el resumen nombra exactamente los récords superados; editar o borrar una sesión los recalcula.
  - **Verificación:** unitarias (récords y bordes, línea, componentes); integración (`health-records.test.ts`). Sin E2E nueva.
- [x] **E4: Hábito, Hoy, revisión y E2E** (M; `feat/health-e4`) — en producción (#181), con la migración aditiva `0031` (marca exacta del hábito) y el arreglo de los ids de la semilla (`z.guid()`) que encontró la primera corrida del E2E
  - Contrato en `habits/contracts.ts` (`getCheckHabitOptions`, `markHabitDoneBySource`, `unmarkHabitBySource`), hoja «Ajustes», marcado al terminar y su «Deshacer»; `getHealthTodaySummary` y el slot «Entreno»; `getHealthWeekReview` y la cifra en «Logros».
  - **El único E2E** `e2e/health.spec.ts` (extiende `boardTest`, limpia sus tablas), `e2e/support/health.ts`, entrada en `SPEC_MODULES` y `ROUTE_MODULES`.
  - **Aceptación:** terminar marca el hábito y el «Deshacer» desmarca solo lo propio; Hoy y «Logros» aparecen y desaparecen según las reglas; el E2E pasa en CI.
  - **Verificación:** unitarias (`today-board`, `logros`, componentes); integración (`health-habit.test.ts`: los cuatro casos del hábito, contratos de Hoy y revisión); `update-screenshots.yml` tras el push (primera corrida del E2E).
- [x] **E5: Cierre** (S; `feat/health-e5`) — los tres hallazgos del Checkpoint (línea desde dos sesiones, «Nota» una sola vez, copiar a las series vacías al marcar) y el cierre
  - Checkpoint en producción (Chrome del owner, datos `[QA]` borrados después), retrospectiva en `CLAUDE.md`, backlog consolidado, mapa, HANDOFF («Cómo funciona health»), archivo del plan y las tareas; carga de las rutinas reales con el owner.

## Checkpoint en producción (2026-11-05)

El orquestador lo hizo en el Chrome personal del owner, con una rutina y una sesión `[QA]` (borradas después; «Entreno» quedó como estaba):

- Rutina `[QA] Rutina` con «Press de banca con barra» (uno de los 55 ejercicios de la semilla que antes no se podían agregar: el arreglo de E4 funciona) y «Plancha» (tiempo), con objetivos y descanso.
- «Empezar esta rutina»: la serie 42,5 kg × 8 se marca en un toque, la barra de descanso arranca sola, «+15 s» y «Saltar» responden; recargar la página conserva la serie y el descanso.
- Hoy con la sesión abierta: «Entreno en curso · [QA] Rutina · 1 min» con «Seguir», que abre la sesión.
- «Terminar»: «1 min · 2 series hechas», las 4 sin marcar se quitan; «Deshacer» reabre la sesión con todo en su lugar; terminar de nuevo.
- Detalle de «Press de banca con barra» (antes 404): récords «Peso máximo 42,5 kg» y «1RM estimado 54 kg», historial y datos.
- «Ajustes»: el selector ofrece «Ninguno» y los hábitos enlazables; sin guardar durante la prueba.
- **Hallazgos** (corregidos en E5): la línea de un ejercicio con una sola sesión ocupaba ~200 px para un punto; «Nota» salía dos veces en la sesión; y, aprobado por el owner, al marcar una serie las siguientes vacías no tomaban sus valores.
- **Después, a pedido del owner:** se creó el hábito «Gimnasio» (a cumplir, sí/no, 3 veces por semana, Salud y Bienestar; las 3 veces son la recomendación aceptada) y se enlazó en «Ajustes».
