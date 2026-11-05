# Plan de implementación: health

> Spec: [`SPEC-health.md`](../../SPEC-health.md) (APROBADA v1.0, 2026-11-04) · Tareas: [`health-todo.md`](health-todo.md)
> Planes anteriores en [`archive/`](./). **Cerrado el 2026-11-05.**

## Enfoque

El de `learning` y `notes`: rebanadas verticales, **un implementador a la vez** (gate local liviano; los archivos de integración nuevos se corren de a uno), rama corta → revisión del commit local (código, seguridad si toca datos, accesibilidad si toca UI) → **un push** → PR a `main` → CI verde verificado antes del merge → deploy y smoke. Trabajo autónomo hasta el **Checkpoint final** (el owner lo pidió el 2026-11-04); decisiones no cubiertas: la opción conservadora, anotada en HANDOFF como «decisión autónoma para revisar con el owner». **Presupuesto E2E:** un solo spec nuevo en todo el módulo (`health.spec.ts`, en E4), con su entrada `["health", "today", "habits"]` en `SPEC_MODULES`.

## Orden y dependencias

```
E1 Catálogo y rutinas ─> E2 Sesión ─> E3 Récords e historial ─> E4 Hábito, Hoy, revisión y E2E ─> E5 Cierre
```

- **E1** crea el módulo: migración `0029` (`health_exercises` con la semilla de 64 por `seed_key` e ids `md5`, `health_routines`, `health_routine_exercises`, `health_settings` con FK a `habits`), `HEALTH_ADVISORY_SPACE = 10000`, manifiesto «Entreno» (`navOrder` 70, `Dumbbell`, bajo «Más»), `/health` (rutinas; huecos para la sesión abierta y «Últimas sesiones»), `/health/exercises` (buscador por `name_key`, filtro por grupo, «Nuevo ejercicio»), `/health/exercises/[id]` (datos editables; hueco para récords), `/health/routines/[id]` (ejercicios, series objetivo, descanso, orden), eliminar con «Deshacer», exportación, regla de ESLint (`HEALTH_ONLY_CONTRACTS` y la excepción de un archivo para la FK a `habits`).
- **E2** la sesión: migración `0030` (`health_sessions` con el único parcial, `health_session_exercises`, `health_sets`), empezar desde rutina o libre (lock `health:session` primero), precarga, serie (peso texto ↔ gramos, reps, segundos, distancia, calentamiento, casilla), añadir/quitar serie y ejercicio, reordenar, nota, barra de descanso, terminar/descartar con el umbral de 4 h y su «Deshacer», `/health/sessions` y `/health/sessions/[id]` (también terminadas, editables), `useSecondClock` a `src/lib`.
- **E3** récords: `records.ts` puro (por tipo, Epley 1–12, «nuevos» estrictos), resumen al terminar con `celebrate`, detalle del ejercicio con récords, línea SVG + tabla y el historial de 20 en 20, récords en las filas de sesiones.
- **E4** integración: contrato de escritura en `habits` (`getCheckHabitOptions`, `markHabitDoneBySource`, `unmarkHabitBySource`), hoja «Ajustes», marcado al terminar y su «Deshacer», `getHealthTodaySummary` y el slot «Entreno» en Hoy, `getHealthWeekReview` y la cifra en «Logros», el único E2E.
- **E5** Checkpoint en producción, retrospectiva en `CLAUDE.md`, backlog, mapa, HANDOFF («Cómo funciona health»), archivo del plan y las tareas, carga de las rutinas reales con el owner.

Todos son secuenciales: E2 usa el catálogo y las rutinas de E1, E3 lee las series de E2, y el E2E de E4 recorre todo.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Dos sesiones abiertas (dos pestañas, Hoy y `/health` a la vez) | Único parcial `WHERE ended_at IS NULL AND deleted_at IS NULL` y lock `(10000, hashtext('health:session'))` como primer lock; el segundo «Empezar» ve la primera y responde «Ya tienes un entreno en curso»; prueba concurrente con control positivo. |
| Se pierde una serie con mala señal en el gimnasio | Cola optimista (`use-save-queue`) con reintento y «Sin guardar» visible; cada serie es su propia fila (nada de guardar la sesión entera); prueba del rechazo y la reversión dentro de `waitFor`. |
| Decimales de peso con coma o punto, o redondeos | `weight.ts` como `splitDecimal` de finanzas: texto → gramos enteros, múltiplos de 250, «,» y «.»; nunca `float` en la base; unitarias de bordes. |
| Récords que cambian al editar o borrar sesiones | Se derivan al leer (sin tabla de récords); integración con sesión borrada y serie corregida. |
| El descanso deja temporizadores vivos o roba el foco | Un intervalo compartido (`useSecondClock`), fin como instante; limpiado al desmontar; la barra no toma el foco y suma su altura a `--toast-offset`; `sessionStorage` envuelto en try/catch. |
| Marcar el hábito pisa una marca manual | Solo marca si no estaba hecho, guarda `habit_marked_day` y el «Deshacer» desmarca solo lo propio y solo si sigue hecho; borrar la sesión no desmarca; pruebas de los cuatro casos. |
| Escritura cruzada en `habits` rompe sus reglas | El contrato nuevo reutiliza `setHabitDoneById` (ventana, archivado, medida) dentro de la transacción de `health`; ESLint solo deja importar `habits/contracts`. |
| Hoy y la revisión cambian para todos los E2E | El slot no sale sin sesión ni hábito pendiente; el spec de `health` extiende `boardTest` y limpia sus tablas antes y después; `e2e/support/*` revisado al añadir tablas. |
| La entrada nueva de navegación rompe E2E y capturas | En E1 revisar `e2e/home.spec.ts` y dispatch de `update-screenshots.yml` justo tras el push; lo mismo en E4 (Hoy y «Logros»). |
| La semilla se duplica o choca con un nombre del owner | `seed_key` único e ids `md5`; `ON CONFLICT DO NOTHING`; integración que corre las sentencias dos veces. |
