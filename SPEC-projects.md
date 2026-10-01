# Spec: projects

> Módulo `projects` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` · Estado: **APROBADO v1** (2026-10-01).

## Objetivo

Gestionar mis proyectos personales, profesionales y del hogar en un solo lugar, con estructura solo cuando hace falta:

- Un proyecto tiene **estado, área de vida, objetivo, prioridad, fechas, notas y enlaces**.
- Los proyectos grandes se dividen en **hitos** (opcionales) con checkbox; el **avance** sale de ahí.
- Puedo ver de un vistazo qué está **activo, bloqueado o por vencer**.

Estrategia de trabajo acordada (2026-10-01): **GTD + PARA con hitos opcionales**.

- **PARA:** los proyectos tienen fin; las áreas de vida (de `core`) son permanentes. Todo proyecto pertenece a un área.
- **Hitos opcionales:** un proyecto chico no necesita estructura; uno grande se divide en hitos.
- **GTD:** la bandeja de entrada, las tareas y la "próxima acción" de cada proyecto llegan con el módulo `tasks`, que se conecta a los proyectos e hitos definidos aquí.
- **Kanban** no es la estructura base. Queda como posible vista futura de un proyecto.

Fuera de este módulo: tareas, bandeja de entrada y próxima acción (`tasks`); metas enlazadas (`goals`); revisión semanal (`weekly-review`); recordatorios por push o email (`reminders`). **No hay importación desde Notion** (decisión del owner, 2026-10-01): empiezo de cero.

### Historias de usuario

1. Creo un proyecto en segundos desde el celular: nombre, área y estado. Lo demás lo completo después.
2. Veo mis proyectos agrupados por estado, con los activos primero, y filtro por área de vida.
3. Divido un proyecto grande en hitos, marco los que termino y veo el avance.
4. Marco que un proyecto está **bloqueado por** otro y lo veo señalado mientras el otro no termine.
5. Veo qué proyectos vencen pronto o ya vencieron, sin tener que abrirlos.
6. Un proyecto continuo (mi web, la casa) queda en **Mantenimiento**: sin fecha de fin ni avance.
7. Termino o cancelo un proyecto y sale de la vista principal, pero sigue en el historial.

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Estados | `idea` · `active` · `paused` · `maintenance` · `done` · `canceled`. En la UI: Idea, Activo, Pausado, Mantenimiento, Terminado, Cancelado. | Decisión del owner (5 recomendados + Mantenimiento). Backlog y Planning de Notion caben en Idea. |
| Transiciones | Libres entre cualquier estado. Pasar a `done` guarda `completed_at`; salir de `done` lo borra. | Un solo usuario: no hace falta un flujo rígido. |
| Área de vida | Obligatoria. Solo se ofrecen áreas activas; un proyecto conserva su área si luego se archiva. | Todo se clasifica por área (PARA). Mismo criterio que `SPEC-core` para áreas archivadas. |
| Prioridad | `low` · `medium` · `high` (Baja, Media, Alta). Por defecto `medium`. | Decisión del owner. Ordena la lista y alimentará `today`. |
| Fechas | `start_date` y `due_date` opcionales, tipo `date` (sin hora), en hora de Lima. `due_date` ≥ `start_date`. | Igual que en Notion; el día importa, la hora no. |
| Vencimiento visible | En proyectos `idea`, `active` o `paused`: "Vence hoy", "Vence en N días" (hasta 7) o "Vencido hace N días". `maintenance`, `done` y `canceled` no muestran vencimiento. | Decisión del owner ("fecha límite visible"). |
| Mantenimiento | Sin avance y sin aviso de vencimiento (la fecha de fin se oculta). | Es trabajo continuo, no tiene fin. |
| Hitos | Opcionales, con título, fecha opcional y checkbox. Se reordenan **arrastrando** (`@dnd-kit`, ya instalado en C6) y con "Subir"/"Bajar" como alternativa accesible. Eliminar un hito es físico, con "Deshacer" que reinserta la misma fila en su lugar (P3). | Estructura solo para proyectos grandes; mismo patrón que áreas. Un hito es una fila hija sin referencias: el borrado lógico es de los proyectos. |
| Avance | Hitos hechos / total, en porcentaje. Sin hitos, no hay avance (no se muestra 0 %). Cuando exista `tasks`, el avance se calcula con las tareas (ver "Contratos"). | Es lo único medible mientras no hay tareas. |
| Dependencias | "Bloqueado por" otros proyectos (muchos a muchos). Un proyecto que no está `done` ni `canceled` está **bloqueado** si alguno de los que lo bloquean no está `done` ni `canceled` (uno terminado o cancelado nunca se marca bloqueado; sus dependencias se conservan y, si se reabre, vuelve a estarlo). Sin ciclos ni auto-dependencia. | Decisión del owner; como "Blocked By" de Notion. |
| Notas | **Markdown** (hasta 20 000 caracteres): se edita como texto, con pestañas "Escribir" y "Vista previa", y se muestra renderizado. Render con `react-markdown` + `remark-gfm` (tablas, listas de tareas, enlaces automáticos) + `rehype-sanitize`; **nunca HTML crudo**. El renderizador vive en `src/lib/markdown/` para reutilizarlo en el futuro visor de Markdown y en `notes`. | Decisión del owner: se agrega la dependencia ahora porque habrá un visor de Markdown más adelante. |
| Enlaces | Lista de URL `http`/`https` con etiqueta opcional, ordenables. | Repositorios, documentos, referencias. |
| Borrar | Sin borrado físico. "Eliminar" es un borrado lógico (`deleted_at`) con "Deshacer" en el aviso; no aparece en ninguna vista. | Mismo principio que `core`. Cancelado sirve para lo que no se hizo; Eliminar, para lo creado por error. |
| Orden de la lista | Por prioridad (alta primero), luego `due_date` (más cercana primero, sin fecha al final) y luego nombre. Sin reordenar a mano. | Un orden útil sin mantenimiento manual. |

## Comandos

Los mismos de `SPEC-core`: `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e e2e/projects*.spec.ts` (nativo, ver `CLAUDE.md`), `pnpm db:generate`, `pnpm build`.

## Estructura

```
src/modules/projects/
  module.ts                 → manifiesto (Proyectos, /projects, atajo 2)
  db/schema.ts              → projects, project_milestones, project_links, project_dependencies
  project-input.ts          → esquemas Zod y tipos para el cliente (sin código de servidor)
  projects.ts               → acceso a datos (server-only)
  queries.ts                → lecturas para las páginas (server-only)
  actions.ts                → Server Actions con ownerAction()
  progress.ts               → cálculo del avance y del vencimiento (puro, probado)
  export.ts                 → registro en pnpm db:export
  components/               → ProjectCard, StatusPicker, MilestoneList, …
src/app/(app)/projects/
  page.tsx                  → lista
  [id]/page.tsx             → detalle
  [id]/not-found.tsx        → proyecto inexistente o eliminado
```

Manifiesto: `projectsModule` con `id: "projects"`, `label: "Proyectos"`, ícono `FolderKanban`, `href: "/projects"`, `navOrder: 20`, grupo `main`, `shortcut: 2`.

## Modelo de datos

```ts
// src/modules/projects/db/schema.ts (sketch)
export const PROJECT_STATUSES = ["idea", "active", "paused", "maintenance", "done", "canceled"] as const;
export const PROJECT_PRIORITIES = ["low", "medium", "high"] as const;

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                       // 1–80, normalized like area names
  objective: text("objective"),                       // ≤ 280: "what done looks like"
  notes: text("notes"),                               // ≤ 20 000, Markdown (rendered sanitized)
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("idea"),
  priority: text("priority", { enum: PROJECT_PRIORITIES }).notNull().default("medium"),
  lifeAreaId: uuid("life_area_id").notNull().references(() => lifeAreas.id, { onDelete: "restrict" }),
  startDate: date("start_date"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectMilestones = pgTable("project_milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),                     // 1–120
  dueDate: date("due_date"),
  doneAt: timestamp("done_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull(),
});

export const projectLinks = pgTable("project_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),                         // http(s) only, ≤ 2048
  label: text("label"),                               // ≤ 80
  sortOrder: integer("sort_order").notNull(),
});

export const projectDependencies = pgTable("project_dependencies", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  blockedById: uuid("blocked_by_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.projectId, t.blockedById] })]);
```

- **Restricciones en la base** (defensa en profundidad, como en C5): `CHECK` de estado, prioridad y largos; `due_date >= start_date`; `project_id <> blocked_by_id`; `completed_at` presente solo si `status = 'done'`.
- **Índices:** `projects (status) WHERE deleted_at IS NULL`, `projects (life_area_id)`, `project_milestones (project_id, sort_order)`.
- **Ciclos:** al agregar una dependencia, una consulta recursiva verifica que `blocked_by` no dependa ya (directa o indirectamente) del proyecto. Si hay ciclo, la acción lo rechaza con un error por campo. Todas las altas toman un `pg_advisory_xact_lock` global del grafo (dos altas simultáneas no pueden cerrar un ciclo entre las dos), y el grafo cuenta también las aristas de los eliminados (al restaurar uno nunca aparece un ciclo).
- **Orden de hitos y enlaces:** contiguo por proyecto, con `pg_advisory_xact_lock` por proyecto, como `LIFE_AREAS_LOCK`.
- **Eliminado:** un proyecto con `deleted_at` no aparece en listas, en dependencias ni en exportaciones de "activos"; sí aparece en `pnpm db:export` (es historial). Si bloqueaba a otro, deja de bloquearlo.
- Migraciones **aditivas**; las tablas se agregan al registro de `pnpm db:export`.

## Pantallas

Diseño con el design system; como referencia visual, el patrón `components/patterns/ProjectCard` y la pantalla de proyectos del proyecto "brahua-os Pantallas" en Claude Design.

**Lista (`/projects`):**
- Encabezado con "Nuevo proyecto" y un filtro por área de vida (chips con `AreaTag`, "Todas" por defecto; el filtro va en la URL, `?area=<slug>`).
- Grupos por estado, en este orden: Activo, Mantenimiento, Pausado, Idea. Terminado y Cancelado van en una sección plegada "Historial" (con la cantidad), como "Archivadas" en áreas.
- Cada `ProjectCard` muestra: nombre, área, prioridad (solo Alta se destaca), avance (si hay hitos), vencimiento (si aplica) y "Bloqueado" (si aplica).
- Estado vacío con una explicación breve y el botón para crear.

**Crear (Sheet):** nombre, área (obligatorios) y estado (Idea por defecto). Guardar lleva al detalle. Objetivo: crear en menos de 10 segundos desde el celular.

**Detalle (`/projects/[id]`):**
- Cabecera: nombre, área, estado y prioridad editables en el lugar (selectores accesibles), y "Bloqueado por …" si aplica.
- Objetivo, fechas (con el vencimiento), avance.
- **Hitos:** lista con checkbox, agregar en línea (Enter agrega otro), editar título y fecha, reordenar arrastrando o con "Subir" y "Bajar" (reutiliza el patrón de áreas, C6), eliminar con "Deshacer".
- **Dependencias:** agregar "Bloqueado por" con un buscador de proyectos (excluye el propio, los eliminados y los que crearían un ciclo); quitar.
- **Enlaces:** agregar, editar, reordenar y quitar.
- **Notas:** Markdown con pestañas "Escribir" / "Vista previa", guardado explícito ("Guardar") y aviso si sales con cambios sin guardar. Fuera de edición se muestran renderizadas.
- Acciones: cambiar estado, Eliminar (con "Deshacer").

Todas las acciones con UI optimista donde el cambio es inmediato (checkbox de hito, estado, prioridad), y avisos con la cola de `@/lib/toast`.

## Contratos con otros módulos

- **`tasks` (siguiente módulo):** `tasks` depende de `projects`, así que `projects` no puede leer tareas. `projects` expone un punto de extensión para el avance: `registerProgressSource(source)` en `src/modules/projects/progress.ts`, donde `tasks` registra una función que devuelve hechas y total por proyecto. Con una fuente registrada, el avance combina hitos y tareas (definido en `SPEC-tasks`). Las tareas podrán pertenecer a un proyecto y, opcionalmente, a uno de sus hitos.
- **`today`:** `projects` expone `getProjectsTodaySummary()` con los proyectos activos que vencen en ≤ 7 días o están vencidos, y los bloqueados. `today` lo consume cuando exista.
- **`goals`:** enlazará metas a proyectos; el contrato se define en `SPEC-goals`.

## Estilo de código

El de `SPEC-core`: Server Actions con `ownerAction(schema, handler)`, `ActionResult`, Zod compartido entre cliente y servidor, `server-only` en acceso a datos, tipos para el cliente en archivos sin código de servidor, fechas con los helpers de `src/lib/time.ts` (hora de Lima). Las reglas de "Lessons from `core`" de `CLAUDE.md` aplican.

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | Zod (largos, fechas, URL `http(s)`), render de Markdown (GFM y saneado: `<script>`, `javascript:` y HTML crudo no pasan), `progress.ts` (avance con 0, algunos y todos los hitos; mantenimiento sin avance), vencimiento en hora de Lima (hoy, 7 días, vencido, cambio de día a medianoche de Lima), orden de la lista, componentes |
| Integración | Crear, editar, cambiar estado (`completed_at`), hitos (orden contiguo con lock, concurrencia), enlaces, dependencias (ciclos directos e indirectos, auto-dependencia), borrado lógico y deshacer, área archivada, acciones sin sesión o con otro usuario, `CHECK` de la base |
| E2E | Crear en el celular (< 10 s, sin teclado extra), lista agrupada y filtro por área, detalle con hitos y avance, dependencia que bloquea y se libera al terminar el otro, vencimiento visible, eliminar y deshacer, axe en ambos temas, capturas por pantalla, tema y viewport |

## Límites

- **Siempre:** las de `SPEC-core` (Zod + `ownerAction`, `requireOwner()` en páginas, migraciones aditivas versionadas, código en inglés y UI en español, actualizar la spec antes de cambiar el diseño).
- **Preguntar primero:** agregar dependencias distintas de `react-markdown`, `remark-gfm` y `rehype-sanitize` (aprobadas), cambios de esquema que alteren datos existentes, cualquier vista nueva (Kanban, línea de tiempo).
- **Nunca:** borrado físico de proyectos; leer tablas de `tasks` desde `projects` (usar el contrato); escribir en Notion.

## Criterios de éxito

1. **Proyectos:** crear (nombre, área, estado) en el celular en menos de 10 s; editar todos los campos; los 6 estados funcionan y `done` registra la fecha de término.
2. **Lista:** agrupada por estado en el orden definido, ordenada por prioridad, fecha y nombre; filtro por área en la URL; Terminado y Cancelado en "Historial".
3. **Hitos y avance:** agregar, editar, reordenar (arrastrando y con Subir/Bajar), marcar y eliminar con "Deshacer"; el avance es hechos/total y no aparece sin hitos ni en Mantenimiento.
4. **Dependencias:** "Bloqueado" aparece mientras algún bloqueador no esté terminado o cancelado; los ciclos y la auto-dependencia se rechazan con un error claro.
5. **Vencimiento:** "Vence hoy / en N días / vencido hace N días" con el día de Lima, solo en Idea, Activo y Pausado.
6. **Notas:** Markdown con vista previa, renderizado saneado (sin HTML crudo ni enlaces `javascript:`).
7. **Datos:** sin borrado físico; eliminar y deshacer funcionan; las tablas están en `pnpm db:export` y en el respaldo semanal; `CHECK` en la base.
8. **Navegación:** "Proyectos" aparece en la barra lateral (atajo 2) y en la barra inferior.
9. **Calidad:** CI en verde, axe en 0 en ambos temas, sin animaciones de desplazamiento con movimiento reducido.

## Decisiones cerradas (2026-10-01)

1. **Área obligatoria:** todo proyecto tiene área de vida (se puede revisar más adelante).
2. **Notas en Markdown** desde ya, con renderizado saneado reutilizable (`src/lib/markdown/`).
3. **Eliminar** es un borrado lógico con "Deshacer"; Cancelar sigue disponible.
4. **Hitos** se reordenan arrastrando y con Subir/Bajar.
5. **Atajo** de Proyectos: tecla `2`.

## Preguntas abiertas

Ninguna por ahora.
