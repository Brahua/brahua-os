# Spec: tasks

> Módulo `tasks` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` y `projects` · Estado: **APROBADO v1** (2026-10-01).

## Objetivo

Capturar y completar tareas con la menor fricción posible, en cualquier área de vida, y conectarlas con los proyectos:

- **Capturar en menos de 10 segundos** desde cualquier pantalla (tecla naranja de captura, o `C` en el escritorio). Lo que no clasificas cae en la **bandeja de entrada**.
- **Completar con un toque.** "Retrasada" se calcula sola por la fecha.
- Las tareas pueden ir **dentro de un proyecto** (y opcionalmente de un hito) o **directo en un área**. Cada proyecto activo muestra su **próxima acción**.
- **Tareas recurrentes** (regar, lavar ropa, pagar algo) sin copias acumuladas.

Estrategia (la de `SPEC-projects`): **GTD + PARA**. La bandeja y la próxima acción son GTD; áreas y proyectos son PARA. La revisión semanal llega con `weekly-review`.

Fuera de este módulo: recordatorios push/email (`reminders`), tablero diario combinado (`today`, que consume el contrato de aquí), hábitos (`habits`). **Sin importación desde Notion** (decisión del owner, 2026-10-01).

### Historias de usuario

1. Estoy en cualquier pantalla del celular, toco la tecla naranja, escribo "comprar pilas" y Enter: queda en la bandeja en menos de 10 segundos.
2. Reviso la bandeja y asigno cada tarea a un área o a un proyecto (y fecha si hace falta), o la elimino.
3. Veo lo que vence hoy y lo atrasado, y lo marco hecho con un toque.
4. En un proyecto veo sus tareas, marco cuál es la **próxima acción**, y el avance del proyecto suma tareas e hitos.
5. "Regar las plantas cada 3 días": al marcarla hecha aparece la siguiente con su nueva fecha.
6. Etiqueto tareas ("limpieza", "compras") y filtro por etiqueta en cualquier área.

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Estados | **Pendiente** y **Hecha** (`done_at`). "Retrasada" es derivada: pendiente con `due_date` anterior al día de Lima. | Decisión del owner: registrar con un toque. |
| Bandeja de entrada | Una tarea sin área y sin proyecto está en la bandeja. No es un estado. | GTD: capturar primero, clasificar después. |
| Área y proyecto | Opcionales. Si tiene proyecto, su área **es la del proyecto** (no se guarda aparte; se lee del proyecto). Si no, puede tener un área propia (activa). | Una sola fuente de verdad; mover un proyecto de área mueve sus tareas. |
| Hito | Opcional; solo si la tarea tiene proyecto, y el hito debe ser de ese proyecto (y no eliminado). | Contrato de `SPEC-projects`. |
| Próxima acción | Marca opcional, **una por proyecto** (índice único parcial). Solo en tareas pendientes de un proyecto. Al completarla, la marca se libera (no salta sola a otra). | GTD; la elige el owner. |
| Prioridad | Baja / Media / Alta, por defecto **Media**, con los mismos LEDs que proyectos. | Coherente con `projects`. |
| Fecha límite | `due_date` opcional (día, sin hora), en hora de Lima. | Igual que proyectos; la hora llega con `reminders` si hace falta. |
| Recurrencia | **Al completar**: al marcar hecha una tarea recurrente se crea la siguiente con la misma información y la nueva fecha. Reglas: cada N días / semanas / meses (contados **desde que la completas**), o ciertos días de la semana, o el día X del mes (la siguiente fecha que cumpla, **a partir de mañana**). Sin copias acumuladas. | Decisión del owner. Las tareas domésticas se cuentan desde la última vez que se hicieron. |
| Recurrencia: completar antes de tiempo | Para "ciertos días de la semana" y "el día X del mes", la siguiente fecha se busca **a partir del día siguiente a lo más tarde entre hoy y la fecha límite de la que se completa** (Lima). Las reglas "cada N días / semanas / meses" siguen contando desde que la completas. | Decisión autónoma (revisión 1 de T3, owner dormido; opción conservadora, **a revisar con el owner**): completar el lunes la del jueves no crea otra para ese mismo jueves. |
| Recurrencia: dónde va la siguiente | Donde estaba la completada, salvo que ese lugar se haya cerrado: si su proyecto está Terminado, Cancelado o eliminado, o su área propia está archivada, la siguiente va a la **bandeja** (sin área, proyecto ni hito; con título, notas, prioridad, etiquetas y regla) y el aviso lo dice. Un hito eliminado no se copia (queda sin hito). | Decisión autónoma (revisión 1 de T3; opción conservadora, **a revisar con el owner**): nada cae en un lugar cerrado y nada se pierde. |
| Deshacer al completar | "Deshacer" en el aviso desmarca la tarea **y borra la siguiente creada por la recurrencia** (si no fue tocada). | Evita duplicados por un toque equivocado. |
| Etiquetas | Libres, opcionales, varias por tarea. Se crean al escribirlas (minúsculas, 1–30 caracteres, sin duplicados). Sirven para filtrar en cualquier área. | Decisión del owner (reemplazan las 12 categorías de Notion). |
| Notas | Markdown opcional con el renderizador de `src/lib/markdown/` (el mismo de proyectos). | Reutilización. |
| Borrar | Borrado lógico (`deleted_at`) con "Deshacer", como proyectos e hitos. Las tareas de un **proyecto eliminado** se ocultan con él (ninguna vista, página, conteo ni acción las alcanza) y vuelven al restaurarlo; un **hito eliminado** se lee como "sin hito" y vuelve con su "Deshacer". | Mismo principio; un proyecto eliminado se puede restaurar con todo lo suyo. |
| Tareas hechas | Se ocultan de las vistas de trabajo; aparecen en "Hechas" (últimos 30 días) y en el proyecto. | Mantener la vista limpia. |

## Pantallas

**Captura rápida (global):** la tecla naranja de la barra inferior (hoy "Próximamente") y la barra lateral abren un Sheet con el campo "¿Qué hay que hacer?" (con el foco) y, **visibles desde el inicio**, área o proyecto y fecha (opcionales; vacíos = bandeja). Enter guarda. Prioridad, etiquetas y recurrencia quedan en "Más detalles" (plegado). Atajo `C` en el escritorio (con las mismas reglas que los demás atajos). Tras guardar, el campo queda listo para otra.

**Tareas (`/tasks`)** con pestañas (enlaces con `?vista=`):
- **Bandeja:** sin área ni proyecto, con acciones rápidas para asignar área, proyecto y fecha.
- **Hoy:** retrasadas y las que vencen hoy.
- **Próximas:** las que vencen en los próximos 7 días, agrupadas por día.
- **Todas:** pendientes, filtrables por área, proyecto y etiqueta (filtros compactos como en proyectos), ordenadas por fecha, prioridad y creación.
- **Hechas:** las de los últimos 30 días, con "Deshacer".

Cada fila: checkbox (un toque completa, con "Deshacer"), título, y metadatos compactos (área o proyecto, fecha con "Vence hoy / Retrasada hace N días", prioridad Alta, etiquetas, ícono de recurrencia). Tocar el título abre el detalle.

**Detalle (Sheet en escritorio, pantalla en celular — como prefiere el patrón `ProjectCard`):** título, notas (Markdown), área/proyecto/hito, fecha, prioridad, etiquetas, recurrencia (editor simple con resumen legible: "Cada 3 días desde que la completas"), próxima acción (si tiene proyecto), eliminar.

**En proyectos:** la sección "Tareas" del detalle del proyecto (lista con agregar en línea, completar, marcar próxima acción, agrupadas por hito si hay hitos) y la tarjeta del proyecto muestra la próxima acción ("Siguiente: …", como en el patrón `ProjectCard` de Claude Design, con el check que la completa).

## Modelo de datos

```ts
// src/modules/tasks/db/schema.ts (sketch)
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const RECURRENCE_KINDS = ["every_days", "every_weeks", "every_months", "weekdays", "month_day"] as const;

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),                    // 1–200, normalized like names
  notes: text("notes"),                              // ≤ 20 000, Markdown
  priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("medium"),
  dueDate: date("due_date"),
  doneAt: timestamp("done_at", { withTimezone: true }),
  lifeAreaId: uuid("life_area_id").references(() => lifeAreas.id, { onDelete: "restrict" }), // only when no project
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
  milestoneId: uuid("milestone_id").references(() => projectMilestones.id, { onDelete: "restrict" }),
  isNextAction: boolean("is_next_action").notNull().default(false),
  recurrenceKind: text("recurrence_kind", { enum: RECURRENCE_KINDS }),
  recurrenceInterval: integer("recurrence_interval"),       // N for every_*
  recurrenceWeekdays: integer("recurrence_weekdays").array(), // 1–7 (ISO) for weekdays
  recurrenceMonthDay: integer("recurrence_month_day"),     // 1–31 for month_day (clamped to month end)
  spawnedFromId: uuid("spawned_from_id"),                   // previous occurrence (undo of complete removes the spawn)
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskTags = pgTable("task_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),             // lowercase, 1–30
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskTagLinks = pgTable("task_tag_links", {
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => taskTags.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.taskId, t.tagId] })]);
```

- **`CHECK`:** largos; `life_area_id` nulo si hay `project_id`; `milestone_id` solo con `project_id`; `is_next_action` solo con `project_id` y sin `done_at`; reglas de recurrencia completas y coherentes (intervalo 1–365, días 1–7 sin repetir, día del mes 1–31).
- **Índices:** `UNIQUE (project_id) WHERE is_next_action AND deleted_at IS NULL` (una próxima acción por proyecto); `(due_date) WHERE done_at IS NULL AND deleted_at IS NULL`; `(project_id)`; `(life_area_id)`.
- **Hito del mismo proyecto:** se valida en la acción, dentro de la transacción, con `FOR SHARE` sobre el hito.
- **Recurrencia:** completar una recurrente crea la siguiente en la **misma transacción** (sin duplicados ante dobles toques: la acción es idempotente por `done_at`).
- **Bloqueos:** la próxima acción (marcar, desmarcar y el "Deshacer" que la devuelve) toma el **lock de tareas del proyecto**, `(TASKS_ADVISORY_SPACE = 3000, hashtext(<proyecto>))`: la convención de dos claves de `projects`, en el espacio propio de `tasks`, y no uno en `PROJECTS_ADVISORY_SPACE`. Es el mismo lock que ya toma toda escritura que mete o saca una tarea de un proyecto (crear, mover, completar con recurrencia), así que la marca se serializa con todas ellas sin coordinar con los locks de `projects` (que siguen siendo de hitos y dependencias). Siempre el primer lock de la transacción, nunca después de un lock de fila; luego la tarea `FOR UPDATE` y el proyecto `FOR SHARE`.
- Migraciones aditivas; tablas en `pnpm db:export` y en el respaldo.

## Contratos

- **Con `projects`:** `src/modules/tasks/progress-source.ts` registra una `ProgressSource` (`registerProgressSource`) que cuenta tareas **no eliminadas** de cada proyecto: hechas = con `done_at`, total = todas. Se carga desde `src/lib/progress-sources.ts`. El texto del medidor de avance pasa de "N de M hitos" a "N de M" con el detalle "hitos y tareas". El aviso de "Marcar como terminado" ya suma tareas abiertas por este mismo contrato.
- **Próxima acción en la tarjeta del proyecto:** `projects` no lee tareas; `tasks` expone `getNextActions(projectIds)` y la lista de proyectos la recibe por una segunda fuente registrada (`registerNextActionSource`, mismo patrón que el avance) — se define en `contracts.ts` de `projects` en la primera tarea de este módulo.
- **Con `today`:** `getTasksTodaySummary(now)` (`src/modules/tasks/contracts.ts`, `server-only`, con `requireOwner()`) devuelve las retrasadas y las que vencen hoy (pendientes, no eliminadas y visibles: nunca las de un proyecto eliminado), por día de Lima, ordenadas por retraso (la más retrasada primero), prioridad (Alta primero) y creación (la más vieja primero), en **una sola consulta**. Cada elemento (`TaskTodayItem`, en `today-summary.ts`) trae solo lo necesario para mostrarla y enlazarla (`taskPath(id)`):
  - `id`, `title`, `priority`, `dueDate` (`YYYY-MM-DD`, siempre presente);
  - `due`: `{ kind: "overdue", days, label: "Retrasada hace N días" }` o `{ kind: "today", days: 0, label: "Vence hoy" }` (las mismas etiquetas de `taskDueState`);
  - `area`: la que la tarea muestra (la propia o la de su proyecto; `null` en la bandeja) y `project`: `{ id, name }` o `null`;
  - `isNextAction` (falso si el proyecto está Terminado o Cancelado: como en la tarjeta del proyecto, la marca de un proyecto cerrado no se muestra; la tarea pendiente sí entra, igual que en la vista Hoy).

## Comandos y estructura

Los mismos de `SPEC-core`. Módulo en `src/modules/tasks/` (como `projects`), páginas en `src/app/(app)/tasks/`, captura global en `src/modules/tasks/components/quick-capture*` montada desde el shell por un punto de extensión (el shell de `core` no importa `tasks`: se registra como los manifiestos).

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | Zod, cálculo de la siguiente fecha de recurrencia (cada regla, fin de mes, días de la semana, cambio de mes y de año, hora de Lima a medianoche), retrasada/vence, orden de las vistas, componentes |
| Integración | Crear en bandeja, asignar área/proyecto/hito (hito de otro proyecto rechazado), completar y deshacer (con y sin recurrencia, doble toque sin duplicar), próxima acción única por proyecto (concurrencia), etiquetas (crear, reutilizar, quitar), borrado lógico, fuente de avance de proyectos, autorización |
| E2E | Captura rápida en el celular en < 10 s, completar con un toque y deshacer, bandeja → asignar, vistas Hoy/Próximas, recurrente que aparece al completar, próxima acción en la tarjeta del proyecto, axe en ambos temas, capturas |

## Límites

- **Siempre:** las de `SPEC-core` y `SPEC-projects`.
- **Preguntar primero:** dependencias nuevas, notificaciones (son de `reminders`), vistas nuevas (calendario, Kanban).
- **Nunca:** que `projects` o `core` importen `tasks` (solo contratos registrados); borrado físico; escribir en Notion.

## Criterios de éxito

1. Captura desde cualquier pantalla en < 10 s (celular y escritorio, tecla `C`).
2. Completar y deshacer con un toque, sin perder la recurrencia ni duplicar.
3. Bandeja, Hoy, Próximas, Todas y Hechas funcionan con sus filtros.
4. Tareas en proyectos e hitos; próxima acción única por proyecto y visible en la tarjeta del proyecto.
5. El avance del proyecto suma hitos y tareas; "Marcar como terminado" avisa las tareas abiertas.
6. Recurrencias: las 5 reglas calculan bien la siguiente fecha en hora de Lima.
7. Etiquetas libres para filtrar en cualquier área.
8. Calidad: CI en verde, axe en 0 en ambos temas, sin animaciones de desplazamiento con movimiento reducido.

## Decisiones cerradas (2026-10-01)

1. **Navegación:** se itera en Claude Design (dónde vive Tareas en la barra inferior y en la lateral, y su atajo). Hasta sincronizar el diseño, la implementación usa una ubicación provisional: **Tareas con el atajo 3** en la barra lateral y en el lugar de "Hábitos" de la barra inferior (Hábitos aún no existe).
2. **Próxima acción:** al completarla, la marca **queda vacía**; el owner elige la siguiente.
3. **Captura:** título con el foco, y área/proyecto y fecha **visibles desde el inicio** (opcionales); el resto en "Más detalles".

## Preguntas abiertas

Ninguna por ahora (la navegación definitiva llega desde Claude Design).
