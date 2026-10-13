# Spec: weekly-review

> Módulo `weekly-review` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `habits`, `tasks`, `projects` y `goals` (y de `core`) · Estado: **APROBADO v1.0** (2026-10-13; el owner aprobó la spec y aceptó las propuestas de las preguntas abiertas).

## Objetivo

Que el domingo por la noche (o el lunes) pueda **cerrar la semana en menos de 5 minutos y empezar la siguiente con un solo objetivo**, sin abrir cuatro módulos ni cargar con culpa. Es el ritual que une lo que ya existe: hábitos, tareas, proyectos y metas.

- **Guiado en 4 pasos** (decisión del owner, 2026-10-13): **Logros → Pendientes → Metas y proyectos → Próxima semana**. Un paso por pantalla, se puede salir y volver sin perder nada; empieza y termina en lo logrado, nunca en deudas (principios UX 7 y 8).
- **Registro mínimo + una nota** (decisión del owner, 2026-10-13): al cerrar se guarda que esa semana quedó revisada y, si quiero, una nota corta («¿qué aprendí?»). Debajo, las semanas anteriores con sus números.
- **Pendientes con lote y elección** (decisión del owner, 2026-10-13): «Mover las N abiertas al lunes» en un toque y, debajo, cada tarea con «Mañana / Otro día / Dejar», con «Deshacer» exacto. Reutiliza la acción de `tasks`, no la duplica.
- **Invitación sin aviso nuevo** (decisión del owner, 2026-10-13): del domingo 18:00 al lunes (Lima) aparece una tarjeta «Semana nueva, pizarra limpia» en `/` (Hoy) y en `/goals`. No hay push ni Telegram nuevos en v1; `reminders` puede ofrecer el aviso más adelante.
- **Un solo número de consistencia:** «Días completos esta semana: 4». Nada de rachas rotas, porcentajes en rojo ni «atrasadas».

Fuera de este módulo: avisos push o por Telegram del ritual, revisión mensual o trimestral, gráficas históricas, comparar semanas, reflexiones guiadas con IA, finanzas en la revisión (v1: sin pagos), importación desde Notion (no hay), editar hábitos, proyectos o metas desde el ritual (solo se enlaza a su pantalla), mover tareas recurrentes más allá de «esta ocurrencia».

### Historias de usuario

1. El domingo a las 20:00 veo en Hoy la tarjeta «Semana nueva, pizarra limpia · Cerrar la semana». La toco y entro al paso 1.
2. **Logros:** «Esta semana: 18 de 24 hábitos · 11 tareas hechas · 2 hitos de proyectos · 1 meta lograda. Días completos: 4.» Sin comparar con otras personas ni con la semana pasada.
3. **Pendientes:** «Quedaron abiertas 4 tareas.» Toco «Mover las 4 al lunes» y salen con fundido; aparece «Deshacer». Una de ellas la dejo donde está («Dejar»); otra va «a mañana».
4. **Metas y proyectos:** veo cada meta activa con su línea de ritmo («Para llegar: ~3 por semana») y los proyectos activos con su progreso y su próxima acción; los bloqueados salen marcados con un hecho, no un reproche. Todo enlaza a su pantalla.
5. **Próxima semana:** escribo el objetivo de la semana que viene (se guarda en el mismo lugar que el de `/goals`) y, si quiero, una nota de esta semana. Toco «Cerrar la semana».
6. Termina en una pantalla de cierre agradable con lo logrado, no con lo que falta. Al volver a Hoy la tarjeta ya no está.
7. El lunes, si olvidé cerrar la semana pasada, `/review` me ofrece primero esa semana (con «Ver esta semana» a un toque).
8. Abajo veo «Semanas anteriores»: la fecha, «Días completos: 4», «18 de 24 hábitos» y mi nota. Nada que borrar ni reabrir.

## Decisiones

| Tema | Decisión | Origen |
|---|---|---|
| Forma | Ritual de 4 pasos en `/review`, un paso por pantalla (`?paso=1…4`), progreso visible, «Atrás» y «Seguir». Se entra y se sale libremente. | Owner, 2026-10-13 |
| Qué semana | Lunes a domingo en `America/Lima`. Por defecto, la **semana en curso**; lunes y martes, si la anterior no tiene revisión, la anterior. `?semana=YYYY-MM-DD` (un lunes) elige cualquier semana pasada o la actual; no una futura. | Owner, 2026-10-13 (aprobada la propuesta) |
| Registro | Tabla `weekly_reviews` con una fila por semana: `week_start`, `completed_at` y `note`. Cerrar es idempotente; volver a cerrar solo actualiza la nota. Sin borrado ni «reabrir» en v1. | Owner, 2026-10-13 |
| Nota | Opcional, 1–280 caracteres, texto plano. | Owner, 2026-10-13 (aprobada la propuesta) |
| Números | Se calculan al abrir; **no** se guardan en la fila (el historial recalcula desde los datos de esa semana). Si luego se corrige un hábito pasado, el número de esa semana cambia: es el dato vivo. | Owner, 2026-10-13 (aprobada la propuesta) |
| Días completos | Un día cuenta si **todos** los hábitos que tocaban ese día (activos, no pausados) quedaron cumplidos. Semana en curso: solo días transcurridos (y hoy solo si ya está completo). Sin hábitos programados ese día: no cuenta como completo ni como fallido. | Owner, 2026-10-13 (aprobada la propuesta) |
| Tareas «abiertas» | Las no hechas, no eliminadas, con fecha límite dentro de la semana o antes. La bandeja sin fecha no entra: se enlaza («N en la bandeja · Procesar»). | Owner, 2026-10-13 (aprobada la propuesta) |
| Mover | «Al lunes» = el lunes de la semana siguiente a la revisada; «Mañana» = mañana (si la semana revisada ya pasó, el lunes). Una tarea recurrente mueve solo esa ocurrencia. «Deshacer» devuelve cada tarea a su fecha anterior solo si sigue en la fecha a la que se movió. | Principios UX + `postpone-one-tap` |
| Objetivo semanal | Se escribe en el paso 4 con el mismo almacén que `/goals` (`weekly_objectives`): una sola fuente de verdad. Se escribe para la semana **siguiente** a la revisada. | Owner, 2026-10-12 (objetivo semanal) |
| Invitación | Tarjeta en `/` y en `/goals` desde el domingo 18:00 hasta el lunes 23:59 (Lima), mientras la semana a revisar no esté cerrada. Sin push ni Telegram. | Owner, 2026-10-13 |
| Finanzas | Fuera de v1. | Owner, 2026-10-13 (aprobada la propuesta) |
| Tono | El paso 1 y el cierre muestran logros. Las abiertas se llaman «Quedaron abiertas», nunca «atrasadas»; ninguna palabra de la lista prohibida de `goals` ni «racha perdida». | Principios UX 7 y 8 |
| Navegación | `/review`, entrada «Revisión» en el módulo, sin atajo numérico (1–8 están ocupados); en el celular va bajo «Más». | Convención |

## Pantallas

- **`/review` (paso 1 · Logros):** encabezado con la semana («Del 12 al 18 de octubre») y «Días completos esta semana: N». Cuatro cifras grandes (hábitos «18 de 24», tareas hechas, hitos de proyectos, metas logradas) y debajo, lo destacado: los hábitos más constantes, las tareas hechas más recientes y los hitos. Sin comparativas.
- **Paso 2 · Pendientes:** «Quedaron abiertas N tareas.» Tecla grande «Mover las N al lunes» y la lista con «Mañana · Otro día… · Dejar» por fila (44 px, foco explícito, `aria-disabled` mientras guarda). «N en la bandeja · Procesar» enlaza a la bandeja. Sin tareas: «Nada abierto. Buen cierre.»
- **Paso 3 · Metas y proyectos:** metas activas con barra y línea de ritmo; proyectos activos con progreso y próxima acción; bloqueados con el hecho («Esperando a …»). Solo lectura con enlaces; las acciones viven en su módulo.
- **Paso 4 · Próxima semana:** campo «Objetivo de la semana del 19 al 25 de octubre» (1–140, el de `goals`), campo opcional «Nota de esta semana» (≤ 280) y «Cerrar la semana».
- **Cierre:** pantalla de logros con la celebración discreta de `core` (respeta movimiento reducido) y «Volver a Hoy».
- **Abajo, «Semanas anteriores»:** las últimas 12 revisadas; cada una con fecha, días completos, «N de M hábitos», tareas hechas y la nota.
- **Tarjeta de invitación** en `/` y `/goals` (componente exportado por el contrato de `weekly-review`).

Principios aplicables (`docs/principios-ux.md`): efecto «nuevo comienzo», regla pico-final, registro en un toque, sin castigo, foco restaurado, toasts que no tapan el control enfocado.

## Modelo de datos

```ts
weeklyReviews = pgTable("weekly_reviews", {
  weekStart: date("week_start").primaryKey(),   // el lunes (Lima)
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  note: text("note"),                           // 1–280, opcional
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- **`CHECK`:** `week_start` es lunes; `note` de 1 a 280 caracteres si existe.
- **Bloqueo:** `WEEKLY_REVIEW_ADVISORY_SPACE = 6000`, `(6000, hashtext(<week_start>))` al cerrar (dos claves, primer lock de la transacción). Cerrar dos veces a la vez deja una fila.
- **Exportación:** la tabla entra a `EXPORTABLE_TABLES` y al respaldo. Migración **aditiva**; sin datos que migrar. Prettier sobre el snapshot de Drizzle tras `pnpm db:generate`.

## Contratos

`weekly-review` es un consumidor: lee de los demás por **sus contratos** y nunca al revés (regla de ESLint nueva, como la de `goals`). Lo que cada proveedor expone:

- **`habits`** (existe `getHabitsWeekSummary(weekStart, now)`): se añade `getHabitsWeekCompleteDays(weekStart, now)` → `{ days, completeDays }` con las reglas de «Días completos», reutilizando las funciones puras de `streak.ts`/`schedule.ts`.
- **`tasks`:** `getTasksWeekReview(weekStart, now)` → `{ doneCount, recentDone[], open[], inboxCount }` y `moveTasksToDate(moves, to)` + `undoMoveTasks(...)`: lote de `postponeTask`, mismas reglas de recurrentes y de exactitud del «Deshacer» (lleva el id y la fecha previa de cada tarea).
- **`projects`:** `getProjectsWeekReview(weekStart, now)` → proyectos activos con progreso, próxima acción, bloqueo, e hitos cumplidos en la semana. Sobre `contributedProgress` y `projectNextActions`.
- **`goals`:** `getGoalsWeekReview(weekStart, now)` → metas activas con su ritmo, las logradas esa semana y las entradas de esa semana; y `getWeeklyObjective(weekStart)` / `setWeeklyObjective(weekStart, text)` (`setWeeklyObjective` es la acción ya existente, expuesta por contrato).
- **`weekly-review` → `today` y `goals`:** `getReviewInvite(now)` → `{ weekStart } | null` y el componente `ReviewInviteCard`. `today` y `goals` la consumen por **raíz de composición** `src/lib/review-extensions.ts` (import por nombre; ni `today` ni `goals` importan `weekly-review` directamente más allá de ese contrato; regla de ESLint).
- **Límites:** `weekly-review` importa solo `core` y los `contracts` de `habits`, `tasks`, `projects` y `goals` (y sus `routes` para enlaces). Ninguno de ellos importa `weekly-review`.

## Comandos y estructura

Los mismos de `SPEC-core`; sin variables de entorno ni servicios externos.

```
src/modules/weekly-review/ → module.ts, db/schema.ts, contracts.ts, routes.ts, week.ts (puro: semana a revisar, ventana de la invitación),
                             review-input.ts (Zod), review.ts (dominio), actions.ts, queries.ts, revalidate.ts, review-copy.ts, components/
src/app/(app)/review/page.tsx
src/lib/review-extensions.ts → raíz de composición de la tarjeta en Hoy y /goals
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | `week.ts` (lunes y martes con la semana anterior abierta o cerrada, domingo 17:59/18:00, lunes 23:59, cambio de mes y de año, bisiesto, medianoche de Lima), Zod (nota, semana), días completos con tabla de casos (pausas, días sin hábitos, semana en curso), copy (**ninguna cadena prohibida** y ningún «atrasad…»), componentes de cada paso |
| Integración | `CHECK` con inserts crudos (no lunes, nota larga), cerrar idempotente y concurrente (dos cierres → una fila, con control positivo), contratos de `tasks` (open/done de la semana, lote y deshacer exacto, recurrentes, tarea cambiada a mano → no se pisa), `getHabitsWeekCompleteDays`, `getProjectsWeekReview`, `getGoalsWeekReview`, objetivo de la próxima semana, invitación (ventana y cerrada), autorización de cada acción, exportación |
| E2E | **Un solo spec nuevo** (presupuesto del CI): el ritual completo en el celular (4 pasos, mover las abiertas con «Deshacer», objetivo y cierre), axe en 0 en ambos temas y 320 px (con `afterSaveSettled`), una captura con `expectScreenshot`; entrada nueva en `SPEC_MODULES` (`scripts/e2e-affected.mjs`) y, como la tarjeta vive en `/`, el spec lleva las etiquetas `@today-*` que exige la lección de `today`. Lo demás es unitario, de componente o de integración. |

Local: solo el gate liviano; los archivos de integración nuevos se pueden correr de a uno (`rtk proxy pnpm test:integration <archivo>`); build, suite completa y E2E los valida el CI. Lecciones de `goals`: fixtures con fechas de inicio anteriores a los registros, `ON DELETE RESTRICT` = `23001`, raíces de composición mockeadas en pruebas de página, y agregar una entrada de navegación cambia otras E2E y capturas.

## Límites

- **Siempre:** las de `SPEC-core` y los módulos anteriores y las lecciones de `CLAUDE.md`: `ownerAction(schema, handler)` y `requireOwner()` en cada página, locks de dos claves, nada se borra físicamente, «Deshacer» exacto con la fila que cambió, foco restaurado y `aria-disabled`, temporizadores limpiados, logs con `describeError`.
- **Preguntar primero:** dependencias nuevas, cambios en `ci.yml` o en la configuración de build, un aviso nuevo en `reminders`, tocar la estructura de otro módulo más allá de añadir su contrato, escribir en producción fuera de migraciones aditivas.
- **Nunca:** texto de culpa, «atrasadas» o conteo de deuda; que otro módulo importe `weekly-review` fuera del contrato; que el ritual edite hábitos, proyectos o metas (solo enlaza); secretos en el repo; PNG hechos en macOS; correr build, integración completa o E2E locales.

## Criterios de éxito

1. **Ritual completo:** de la tarjeta a «Cerrar la semana» en ≤ 5 minutos con datos reales; cada paso se entiende solo y se puede salir y volver.
2. **Logros correctos:** «N de M hábitos», tareas hechas, hitos y metas logradas coinciden con las pantallas de cada módulo para esa semana (misma regla, función compartida); «Días completos» sigue la tabla de casos.
3. **Pendientes:** «Mover las N al lunes» mueve exactamente esas tareas (recurrentes: solo la ocurrencia), muestra «Deshacer» y este devuelve cada una a su fecha anterior solo si no cambió; una tarea editada mientras tanto no se pisa.
4. **Objetivo y cierre:** el objetivo de la próxima semana se guarda en el mismo lugar que el de `/goals`; cerrar es idempotente (dos cierres a la vez = una fila) y el historial lista la semana con su nota.
5. **Invitación:** la tarjeta aparece solo del domingo 18:00 al lunes 23:59 (Lima) y mientras la semana a revisar no esté cerrada; no hay avisos nuevos.
6. **Tono:** ninguna cadena prohibida (prueba automática); el ritual empieza y termina en logros.
7. **Fronteras:** `weekly-review` lee solo por contratos y los proveedores no lo importan (ESLint).
8. **Calidad:** CI en verde; axe en 0 en ambos temas; movimiento reducido respetado; 320 px sin scroll horizontal; la tabla en `pnpm db:export` y en el respaldo; HANDOFF, `todo` y mapa actualizados tras cada merge.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec. Un implementador a la vez (gate liviano). Cada corte añade **como máximo un E2E** (solo W3).

- **W1 — Cimientos y contratos:** migración, `week.ts` puro, `getHabitsWeekCompleteDays`, `getTasksWeekReview` con `moveTasksToDate`/`undoMoveTasks`, `getProjectsWeekReview`, `getGoalsWeekReview` y el contrato del objetivo semanal; regla de ESLint; pruebas de integración de contratos. Sin pantalla nueva.
- **W2 — Pasos 1 y 2:** `/review` con Logros y Pendientes (lote y por fila, «Deshacer»), módulo en la navegación. Sin E2E.
- **W3 — Pasos 3 y 4, cierre y registro:** Metas y proyectos, Próxima semana, «Cerrar la semana», pantalla de cierre, «Semanas anteriores». El único E2E (ritual completo).
- **W4 — Invitación y cierre del módulo:** `getReviewInvite`, `ReviewInviteCard` en `/` y `/goals` por la raíz de composición, retrospectiva, backlog, mapa y HANDOFF; Checkpoint en producción (Chrome del owner, datos `[QA]`).

## Preguntas abiertas

Ninguna: el owner aprobó las propuestas el 2026-10-13 (semana por defecto: la en curso y, lunes y martes, la anterior si no está cerrada; hitos de proyectos de la semana; finanzas fuera de v1).
