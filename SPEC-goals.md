# Spec: goals

> Módulo `goals` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `habits` y `projects` (y de `core`) · Estado: **APROBADO v1.0** (2026-10-12; el owner aprobó la spec y aceptó las propuestas de las preguntas abiertas).

## Objetivo

Que lo que quiero lograr este año y este trimestre **viva en un lugar y se mueva solo cuando hago lo de siempre**: metas anuales y trimestrales enlazadas a mis hábitos y proyectos (o con una cantidad que anoto a mano: libros, km) y un objetivo para la semana. El módulo me muestra el **ritmo** como siguiente paso, nunca como reproche.

- **Meta = una fuente de avance** (decisión del owner, 2026-10-12): cada meta elige **una** fuente: un **hábito** (días cumplidos en el periodo), un **proyecto** (su % de avance) o una **cantidad manual** con meta numérica y unidad.
- **Anuales y trimestrales independientes** (decisión del owner, 2026-10-12): una meta es del año o de un trimestre; no hay jerarquía ni avance heredado.
- **Objetivo semanal sencillo** (decisión del owner, 2026-10-12): un texto corto por semana, fijado en `/goals`. `weekly-review` lo propondrá y cerrará después.
- **Ritmo, no atraso:** «Vas 2 por delante de tu ritmo», «Para llegar, ~3 por semana»; jamás «atrasada», «en riesgo» ni «fallaste».

Fuera de este módulo: metas de dinero (decisión del owner, 2026-10-06), metas con varias fuentes o pesos, jerarquía anual → trimestral, **importación desde Notion** (empiezo de cero), tarjeta en `today` (decisión del owner, 2026-10-12: se evalúa luego), avisos de `reminders`, la revisión semanal (`weekly-review`) y cursos (`learning`, que enlazará metas por `id`).

### Historias de usuario

1. Creo «Leer 12 libros» (anual, cantidad manual, unidad «libros»). Al terminar uno toco «+1» y veo «5 de 12 · vas 1 por delante de tu ritmo», con «Deshacer».
2. Creo «Correr 3 veces por semana todo el trimestre» enlazada al hábito «Correr»: el avance sale solo de los días que lo marco en Hábitos («34 de 40 días»), sin tocar nada aquí.
3. Enlazo «Lanzar brahua-os v1» al proyecto: la barra sigue el progreso del proyecto (hitos y tareas) y no se puede editar a mano.
4. En `/goals` veo primero **el objetivo de esta semana** (lo escribo o edito en un toque) y debajo mis metas del trimestre y del año, cada una con su barra y su ritmo.
5. Una meta del trimestre pasado quedó a 7 de 10: aparece en «Anteriores» con su valor final, sin color de alarma; puedo marcarla lograda, «Pasar al próximo trimestre» o archivarla.
6. Cuando llego a la meta, la meta pasa a «Lograda» con una celebración discreta (la de `core`, respetando movimiento reducido).
7. Desde el detalle de un hábito o un proyecto enlazado puedo ir a su meta y al revés (enlace en ambos sentidos, sin que el módulo origen conozca a `goals`).

## Decisiones

| Tema | Decisión | Origen |
|---|---|---|
| Periodos | `year` (año calendario) o `quarter` (T1–T4, trimestres calendario). Se calcula en `America/Lima`. Sin jerarquía. | Owner, 2026-10-12 |
| Fuente de avance | Exactamente una por meta: `habit`, `project` o `manual`. Cambiarla después reinicia la lectura, no borra entradas manuales. | Owner, 2026-10-12 |
| Hábito → avance | **Días cumplidos** del hábito dentro del periodo (`isDoneOn`, pausas y días no programados fuera del conteo). La meta es un número de días (p. ej. 200). **No** se usa la racha como avance: una racha rota se leería como pérdida. | Owner, 2026-10-12 (aprobada la propuesta) |
| Proyecto → avance | El progreso calculado del proyecto (0–100 %) por el contrato de `projects`; la meta se logra cuando el proyecto pasa a «terminado». | Owner, 2026-10-12 (aprobada la propuesta) |
| Manual → avance | Suma de entradas (`+N`, también negativas para corregir) contra `target` con `unit`. Cada entrada es una fila y se puede deshacer. | Owner, 2026-10-12 |
| Ritmo | `esperado = target × (días transcurridos / días del periodo)`. Texto: «por delante» si avance ≥ esperado + 1 unidad (o 5 %), «a tu ritmo» en el rango, y si va por debajo, **solo el siguiente paso**: «Para llegar: ~N por semana». Nunca «atrasada», rojo ni conteo de deuda. Metas de proyecto no tienen ritmo (su fecha es la del proyecto). | Mapa y principios UX |
| Cierre | Una meta pasa a `achieved` sola al llegar al `target` (o al terminar el proyecto) y puede reabrirse. Si termina el periodo sin lograrse, **no cambia de estado**: pasa a «Anteriores» con su valor final. | Owner, 2026-10-12 (aprobada la propuesta) |
| Eliminar | Nada se borra físicamente: archivar (`archived`) y `deleted_at` con «Deshacer» (patrón de los demás módulos). | `CLAUDE.md` |
| Objetivo semanal | Un texto (1–140 caracteres) por semana lunes–domingo (Lima), o ninguno. Editable en línea; la semana nueva empieza vacía con un «Fijar objetivo». | Owner, 2026-10-12 |
| Área de vida | Opcional (`life_areas` de `core`) para agrupar y filtrar, como en los otros módulos. | Convención |
| Hábito semanal | La medida es siempre **días cumplidos** (en un hábito de X por semana cuenta cada día registrado). | Owner, 2026-10-12 (pregunta 1) |
| Lograr | Una meta se logra **sola** al llegar al `target`; se puede reabrir. | Owner, 2026-10-12 (pregunta 2) |
| Proyecto lograda | Una meta de proyecto se logra cuando el proyecto pasa a **«terminado»**; antes muestra su % de progreso. | Owner, 2026-10-12 (pregunta 3) |
| Orden | Manual con arrastre dentro de cada periodo, como en hábitos (no por ritmo). | Owner, 2026-10-12 (pregunta 4) |
| Navegación | Entrada «Metas» en el módulo (`module.ts`, `navGroup: "main"`); lugar provisional hasta iterar la navegación en Claude Design. | Convención |

## Pantallas

- **`/goals`:** arriba, «Esta semana» con el objetivo semanal (editable en un toque, foco explícito). Luego dos secciones, «Este trimestre (T4 2026)» y «Este año (2026)»; cada meta es una fila con título, barra, «5 de 12 libros» y la línea de ritmo. Filtro por área. «Anteriores» plegado al final (periodos pasados y archivadas).
- **Crear/editar (Sheet):** «Título», «Periodo» (Año · Trimestre; por defecto el actual), «¿Cómo la mido?» (Hábito · Proyecto · Cantidad). Hábito: selector de hábito activo y «Días a cumplir». Proyecto: selector de proyecto. Cantidad: «Meta» y «Unidad». «Área» opcional y «Notas» plegadas. Objetivo: crear una meta en < 20 s en el celular.
- **Meta manual:** botones «+1» y «Sumar…» en la fila; el toque suma y muestra «Deshacer»; el detalle lista las entradas.
- **Detalle de meta** (`/goals/[id]`): barra, ritmo, fuente enlazada (con enlace al hábito o proyecto), historial de entradas (manual), «Marcar lograda», «Pasar al próximo periodo», «Archivar».
- **Vacíos:** sin metas, un ejemplo y «Crear mi primera meta»; sin objetivo semanal, «Fijar objetivo de la semana». Copy en español, tono sin culpa, sin «¡Felicidades!» repetido.

Principios aplicables (`docs/principios-ux.md`): registro en un toque, color nunca como único canal, sin castigo por no cumplir, `aria-disabled` en vez de `disabled` con foco, toasts que no tapan el control enfocado.

## Modelo de datos

```ts
goals = pgTable("goals", {
  id, title: text, notes: text | null,
  periodKind: text,                 // 'year' | 'quarter'
  year: integer, quarter: integer | null,        // 1–4 solo si periodKind = 'quarter'
  sourceKind: text,                 // 'habit' | 'project' | 'manual'
  habitId: uuid | null, projectId: uuid | null,  // FK a habits / projects (ON DELETE RESTRICT)
  target: integer,                  // días (habit) · unidad (manual) · 100 (project, fijo)
  unit: text | null,                // solo manual, 1–20 caracteres
  areaId: uuid | null,              // life_areas
  status: text,                     // 'active' | 'achieved' | 'archived'
  achievedAt: timestamptz | null, position: integer,
  deletedAt, createdAt, updatedAt,
});
goalEntries = pgTable("goal_entries", {     // solo fuente manual
  id, goalId, delta: integer, entryDate: date, deletedAt, createdAt,
});
weeklyObjectives = pgTable("weekly_objectives", {
  weekStart: date (PK, lunes de Lima), text: text, updatedAt,
});
```

- **`CHECK`** (con `coalesce(…, false)` como en `habits`): largos; `year` 2000–2100; `quarter` 1–4 si y solo si `periodKind = 'quarter'`; cada `sourceKind` con exactamente su campo (`habit` → `habitId`, sin `projectId` ni `unit`; `project` → `projectId`, `target = 100`; `manual` → `unit` presente y sin `habitId`/`projectId`); `target` 1–100 000; `delta` ≠ 0 y |delta| ≤ 100 000; `weekStart` es lunes.
- **Bloqueos:** `GOALS_ADVISORY_SPACE = 5000` (dos claves, siempre el primer lock de la transacción, nunca después de un lock de fila): `(5000, hashtext('goals:order'))` para crear, reordenar y archivar; `(5000, hashtext(<goal_id>))` para registrar entradas, cambiar fuente o meta y lograr/reabrir. Documentado junto al lock.
- **Exportación:** las tres tablas entran a `EXPORTABLE_TABLES` y al respaldo (`pnpm db:export`).
- Migración **aditiva** (tablas nuevas); sin datos que migrar. `prettier` sobre el snapshot de Drizzle tras `pnpm db:generate`.

## Contratos

- **`goals` → `habits`:** `habits/contracts.ts` gana `getHabitDoneDays(habitId, from, to)` → `{ done, expected }` reutilizando `isDoneOn`/`weekCompliance` (funciones puras ya existentes); el cuerpo vive en `habits`, `goals` solo lo importa.
- **`goals` → `projects`:** `projects/contracts.ts` gana `getProjectProgress(projectId)` → `{ percent, status }` sobre `contributedProgress` (llama antes a `ensureProgressSources()`).
- **Dirección única:** `goals` importa `@/modules/habits/contracts` y `@/modules/projects/contracts`; ninguno de los dos importa `goals`. Los enlaces desde el detalle de un hábito o proyecto hacia su meta pasan por un contrato registrado (`registerHabitSection` / `registerProjectSection`, patrón de `project-extensions`) y una raíz de composición `src/lib/goal-extensions.ts` importada por nombre (nunca un `import` solo por efecto: `sideEffects: false` lo elimina). Regla nueva en `eslint.config.mjs`.
- **A futuro:** `weekly-review` leerá `getGoalsWeekSummary(weekStart)` y el objetivo semanal; `learning` enlazará metas por `id`. Aquí solo se garantiza que `pace.ts` y `progress.ts` son funciones puras.

## Comandos y estructura

Los mismos de `SPEC-core`, más ninguno nuevo (sin variables de entorno ni servicios externos).

```
src/modules/goals/   → module.ts, db/schema.ts, contracts.ts, routes.ts, goal-input.ts (Zod), goals.ts (consultas y
                       acciones de dominio), progress.ts (puro: avance por fuente), pace.ts (puro: periodo y ritmo),
                       weekly.ts, goals-copy.ts (copy sin culpa), actions.ts, revalidate.ts, components/
src/app/(app)/goals/page.tsx, src/app/(app)/goals/[id]/page.tsx
src/lib/goal-extensions.ts   → raíz de composición de las secciones en hábitos y proyectos
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | `pace.ts` (límites del año y de cada trimestre en Lima, 31-dic/1-ene, año bisiesto, medianoche, primer y último día, esperado y «por delante»/«a tu ritmo»/«siguiente paso»), `progress.ts` por fuente, Zod (periodo, fuente exclusiva, límites, unidad), copy (**ninguna cadena prohibida**: «atrasad», «riesgo», «fallaste», «deuda», «⚠️», «racha perdida») |
| Integración | `CHECK` con inserts crudos (cada combinación de fuente inválida), crear/editar/archivar/eliminar y deshacer con `visibleGoal`, entradas manuales (dos «+1» a la vez suman dos bajo el lock, con control positivo; deshacer exacto de la entrada), lograr y reabrir (idempotente), `getHabitDoneDays` con pausas y días no programados, `getProjectProgress`, meta pasada que **no** cambia de estado, «Pasar al próximo periodo», objetivo semanal (crear, editar, semana nueva vacía), autorización de cada acción, exportación |
| Componentes | Fila de meta (barra, ritmo, `aria-valuenow`), formulario (cambia campos según la fuente), objetivo semanal (foco restaurado tras guardar), «Deshacer» con la fila revertida dentro de `waitFor` |
| E2E | **Un solo spec nuevo** (presupuesto del CI): crear una meta manual en < 20 s, sumar +1 con «Deshacer», fijar el objetivo semanal, axe en 0 en ambos temas y 320 px (con `afterSaveSettled`), una captura con `expectScreenshot`; entrada nueva en `SPEC_MODULES` (`scripts/e2e-affected.mjs`). Lo demás es unitario, de componente o de integración. |

Local: solo el gate liviano (prettier, eslint, typecheck y las unitarias tocadas); build, suite completa, integración, E2E, axe y capturas los valida el CI.

## Límites

- **Siempre:** las de `SPEC-core` y los módulos anteriores y las lecciones de `CLAUDE.md`: `ownerAction(schema, handler)` y `requireOwner()` en cada página, validar listas de ids como conjuntos, locks de dos claves, nada se borra físicamente, foco restaurado y `aria-disabled`, temporizadores limpiados al desmontar, logs con `describeError`. Atender la frontera por regla de ESLint.
- **Preguntar primero:** dependencias nuevas, cambios en `ci.yml` o en la configuración de build, metas de dinero o de varias fuentes, `today` o `reminders` leyendo metas, cualquier escritura destructiva en producción.
- **Nunca:** texto de culpa, «atrasada» o conteo de deuda; que `habits` o `projects` importen `goals` más allá del contrato registrado; secretos en el repo; PNG hechos en macOS; correr localmente build, integración o E2E completos.

## Criterios de éxito

1. **Crear:** una meta de cada fuente (hábito, proyecto, manual) se crea en < 20 s desde el celular y aparece en su periodo.
2. **Avance correcto:** el hábito cuenta solo días cumplidos del periodo (pausas y días no programados fuera); el proyecto sigue su progreso; lo manual suma, corrige y deshace exactamente la entrada.
3. **Ritmo sin culpa:** el texto de ritmo cambia entre «por delante», «a tu ritmo» y «siguiente paso»; ningún texto del módulo contiene las cadenas prohibidas (prueba automática).
4. **Periodos:** los límites de año y trimestre en Lima son correctos (31-dic, 1-ene, bisiesto); una meta vencida sin lograr queda en «Anteriores» sin cambiar de estado.
5. **Cierre:** al llegar al `target` pasa a «Lograda» una sola vez (dos entradas a la vez no la logran dos veces); se puede reabrir.
6. **Objetivo semanal:** se fija y edita en un toque; la semana nueva empieza vacía.
7. **Fronteras:** `habits` y `projects` no importan `goals` (ESLint); el módulo lee solo por contratos.
8. **Calidad:** CI en verde; axe en 0 en ambos temas; movimiento reducido respetado; 320 px sin scroll horizontal; tablas en `pnpm db:export` y en el respaldo; `HANDOFF`, `todo` y mapa actualizados tras cada merge.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec. Un implementador a la vez (gate liviano). Cada corte añade **como máximo un E2E**.

- **G1 — Cimientos y metas manuales:** migración, `pace.ts`/`progress.ts` puros, `/goals` con crear/editar/archivar, entradas «+N» con «Deshacer», lograr y reabrir, «Anteriores», módulo en la navegación, exportación. (Una E2E.)
- **G2 — Hábito y proyecto:** contratos `getHabitDoneDays` y `getProjectProgress`, fuentes `habit` y `project`, selectores en el formulario, regla de ESLint. (Sin E2E nueva.)
- **G3 — Objetivo semanal y enlaces:** `weekly_objectives`, edición en línea, secciones de meta en el detalle de hábitos y proyectos (`goal-extensions`). (Sin E2E nueva.)
- **G4 — Cierre:** «Pasar al próximo periodo», retrospectiva, backlog consolidado, mapa y `HANDOFF`; Checkpoint con el owner en producción (Claude in Chrome, datos `[QA]`).

## Preguntas abiertas

Ninguna: el owner aprobó las cuatro propuestas el 2026-10-12 (ver «Decisiones»).
