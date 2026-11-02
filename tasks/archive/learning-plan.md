# Plan de implementación: learning

> Spec: [`SPEC-learning.md`](../../SPEC-learning.md) (APROBADA v1.0, 2026-10-29) · Tareas: [`learning-todo.md`](learning-todo.md)
> Planes anteriores en [`archive/`](./). **Cerrado el 2026-11-02.**

## Enfoque

El de `household`: rebanadas verticales, **un implementador a la vez** (gate local liviano; los archivos de integración nuevos se corren de a uno), rama corta → PR a `main` → CI verde verificado antes de cada merge → deploy y smoke. Cada agente hace push **una vez**. Trabajo autónomo hasta el **Checkpoint final**; decisiones no cubiertas: la opción conservadora, anotada en HANDOFF como «decisión autónoma para revisar con el owner». **Presupuesto E2E:** un solo spec nuevo en todo el módulo (`learning.spec.ts`, en L3), con su entrada `["learning", "today", "projects"]` en `SPEC_MODULES` y las etiquetas `@today-tasks` si toca Hoy.

## Orden y dependencias

```
L1 Frentes y temario ─> L2 Tiempo y sesiones ─> L3 Hoy, proyectos, revisión y E2E ─> L4 Cierre y carga real
```

- **L1** crea el módulo: migración aditiva de `learning_tracks` y `learning_steps` (`CHECK`, FK a `projects` con `ON DELETE RESTRICT`), `LEARNING_ADVISORY_SPACE = 8000`, manifiesto «Aprendizaje» (`navOrder` 68, sin atajo ni `bottomNavOrder`: en el celular va bajo «Más»), `/learning` con «En curso / En espera / Terminados», hoja «Nuevo frente» con temario pegado, detalle `/learning/[id]` con temario (marcar, añadir, renombrar, reordenar, quitar) y ajustes (meta semanal, fecha objetivo, proyecto, enlace), el límite de 2 en curso, ritmo a la fecha y la regla de ESLint de fronteras. Deja en el detalle el slot de «Sesiones» para L2. Va primero porque todo lo demás lee frentes y pasos.
- **L2** migración `learning_sessions` (único parcial de la sesión corriendo), `pace.ts` con la semana de Lima, cronómetro («Estudiar» / «Detener», umbral de 4 h, iniciar otro detiene el anterior), «Anotar tiempo» (1–600 min, hasta 30 días atrás), lista de sesiones por semana con «Deshacer» y la meta semanal en la lista y el detalle.
- **L3** es el único corte que toca otros módulos, cada uno por contrato: la sección «Estudio» en `today` (`getLearningTodaySummary`), la fuente de avance en `projects` (con el cambio a `done` fraccionario en `progress.ts`), la cifra «Estudio» en `weekly-review` (`getLearningWeekReview`) y el único E2E.
- **L4** retrospectiva en `CLAUDE.md`, backlog, mapa, HANDOFF («Cómo funciona learning»), archivo del plan y las tareas, Checkpoint en producción y carga de los frentes reales con el owner (por la interfaz, como en «Mi hogar»).

Las tres primeras son secuenciales por datos (L2 necesita frentes; L3 necesita frentes, pasos y sesiones).

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Más de 2 frentes en curso por dos solicitudes a la vez | Lock `(8000, hashtext('learning:active'))` como **primer** lock al crear en curso, poner en curso o reabrir; prueba concurrente con control positivo (con 1 en curso, una de dos sí entra). |
| Dos cronómetros corriendo (dos «Estudiar» a la vez, dos pestañas) | Índice único parcial `WHERE ended_at IS NULL AND deleted_at IS NULL`; iniciar detiene la anterior en la misma transacción; prueba concurrente. |
| El cronómetro de la tarjeta deja temporizadores vivos | Un solo `setInterval` por componente, limpiado al desmontar; el tiempo se calcula desde `started_at`, nunca acumulando ticks. |
| La semana de Lima corta mal una sesión (domingo → lunes, medianoche) | Regla única en `pace.ts`: la sesión cuenta en la semana de su **inicio**; tabla unitaria con lunes 00:00, domingo 23:59 y cruce. |
| `done` fraccionario rompe otros textos o el avance de hitos en `projects` | Cambio acotado a `clean` y `combineProgressCounts`; `milestoneCountsFor` no cambia. Unitarias de la suma (1 de 2 tareas + frente al 50 % = 1,5 de 3 → 50 %, «1 de 3») y revisión de cada uso de `progress.done` antes del push. |
| `weekly-review` y `today` importan `learning` fuera del contrato | Regla de ESLint con las dos excepciones solo para `@/modules/learning/contracts`; la raíz de composición se mockea en las pruebas de página. |
| La entrada nueva de navegación rompe E2E y capturas | Se añade en L1; revisar `e2e/home.spec.ts` (cuenta enlaces) y hacer dispatch de `update-screenshots.yml` justo tras el push. |
| Hoy y la revisión cambian capturas existentes | En L3, dispatch de `update-screenshots.yml` tras el push (también es la primera corrida del E2E nuevo); grep de las specs que leen la sección de Hoy y «Logros» antes del push. |
| Un E2E de Hoy cruza la medianoche de Lima | Los minutos y «Sigue con» no dependen del día salvo la semana; el E2E crea la sesión con reloj de prueba o fechas relativas al día de Lima del proceso. |
| Tono de culpa («atrasado», «fallaste») | Prueba automática de cadenas prohibidas sobre todo el copy de cada corte. |
| Pegar un temario enorme o con caracteres de control | Zod: máximo 500 pasos y 200 caracteres por línea, NUL rechazado, líneas vacías ignoradas; el `CHECK` acepta lo mismo. |

## Checkpoints

- **Tras L1:** crear un frente con temario pegado, marcar pasos y ver el siguiente; el tercero en curso se rechaza con la oferta de pasar uno a espera.
- **Tras L2:** el cronómetro sobrevive a recargar; «Anotar tiempo» entra en la semana correcta; la meta semanal suma.
- **Tras L3:** «Sigue con» en Hoy, el avance del proyecto enlazado sube con el frente pesando como una tarea, «Estudio» en «Logros»; el E2E pasa en CI.
- **Checkpoint final:** recorrido del agente en producción con el Chrome personal del owner (datos `[QA]` que luego borra); carga de los frentes reales con el owner; el iPhone queda para el owner.
