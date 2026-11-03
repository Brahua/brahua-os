# Spec: notes

> Módulo `notes` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` y, por contratos, de `projects`, `tasks`, `habits`, `goals`, `learning` y `today` · Estado: **APROBADA v1.0** (2026-11-03: el owner aceptó todas las recomendaciones de la tanda de preguntas del 2026-11-02 y pidió construir el módulo completo en modo autónomo).

## Objetivo

Que brahua-os sea un «segundo cerebro» de verdad: **escribir el día y guardar lo que se aprende en el mismo lugar donde viven las tareas, los proyectos y los hábitos, y que lo escrito se conecte con ellos**. El daily log de Notion se abandonó porque escribir no movía nada; aquí una nota enlaza lo que nombra, una línea se vuelve tarea y lo escrito se encuentra después (benchmark rimu, propuesta `daily-note-links`).

- **Nota del día:** una por día de Lima (`/notes/2026-11-02`), sin título (su título es la fecha), abierta desde Hoy con «Nota de hoy».
- **Nota de conocimiento:** con título (`/notes/<id>`), para ideas, apuntes de estudio y referencias.
- **Markdown** con el renderizador saneado de `src/lib/markdown/` y **guardado automático** (owner: sin botón «Guardar»).
- **`[[enlaces]]`** a notas, proyectos, tareas, hábitos, metas y frentes de Aprendizaje, guardados por id; **backlinks** en la nota («Enlazada desde») y en el detalle de cada entidad («Aparece en 3 notas»).
- **Línea → tarea:** una línea `- [ ] …` se convierte en tarea de la bandeja y queda como enlace con la casilla real de la tarea (el estado vive solo en la tarea).
- **Búsqueda** de texto completo dentro de Notas (Postgres, español, sin acentos ni mayúsculas, con prefijos).
- **Captura rápida «Nota»** (Tarea · Gasto · Nota): añade una línea con la hora a la nota del día.
- **Pie «Ese día»** en la nota del día: lo que pasó en la app ese día (tareas hechas, hábitos cumplidos), de solo lectura.

Fuera de este módulo (backlog): grafo (descartado con el owner, 2026-10-06), `@` para marcar hábitos, carpetas y etiquetas, imágenes y adjuntos, historial de versiones, plantillas con preguntas guía, notas de la semana en la revisión semanal, búsqueda global (⌘K), `/nota` por Telegram, IA y audio → texto, importación desde Notion (se empieza de cero; un script a pedido si el owner quiere traer algo puntual).

### Supuestos (aprobados con la tanda del 2026-11-02)

1. **Nombre «Notas»**, ruta `/notes`; en la barra lateral después de Aprendizaje (`navOrder` 69); en el celular bajo «Más». Sin atajo de número (1–8 ocupados); la tecla **`N`** abre la nota de hoy en escritorio.
2. **Una tabla, dos tipos** (`daily`, `page`). La nota del día se crea al escribir la primera letra (nunca filas vacías) y se puede escribir para cualquier día pasado; no para días futuros.
3. **Markdown, sin editor de bloques ni dependencias nuevas.** Hasta 50 000 caracteres por nota (un diario largo no cabe en los 20 000 de proyectos).
4. **Enlaces por id:** `[[type:id|Nombre]]`. Renombrar no rompe nada (se dibuja el nombre actual); lo borrado se dibuja como «Nombre (ya no existe)», sin enlace.
5. **Nada se borra físicamente:** `deleted_at` con «Deshacer». Todo entra en `pnpm db:export` y en el respaldo.
6. **Dos dispositivos no se pisan:** cada guardado lleva la versión que se editó; si el servidor tiene otra, «Cambió en otro dispositivo» y el texto queda como borrador (como en proyectos).

### Historias de usuario

1. En Hoy toco «Nota de hoy»: se abre la nota del 3 nov con el cursor en el texto. Escribo; un segundo después de parar se ve «Guardado».
2. Escribo «Hablé con Ana sobre [[Ru» y elijo «Ruta AWS + IA» en la lista que aparece debajo: queda un enlace que abre el proyecto. En el proyecto veo «Aparece en 1 nota» con la nota del 3 nov.
3. Escribo «- [ ] Llamar al banco» y, al terminar de editar, la línea muestra «Convertir en tarea». La toco: la tarea queda en la bandeja y la línea pasa a ser su casilla. Al marcarla en la nota, la tarea se completa; al completarla en Tareas, la nota la muestra hecha.
4. En la calle aprieto la tecla naranja, elijo «Nota» y escribo «idea: comparar Neon con Supabase»: la nota de hoy gana «- 18:42 idea: comparar Neon con Supabase», con «Deshacer».
5. Creo «Apuntes IAM» (nota de conocimiento), la fijo y le pongo el área «Aprendizaje y Desarrollo profesional».
6. Busco «polit» en `/notes`: aparece «Apuntes IAM» con «… IAM **policies** se evalúan …» resaltado.
7. Abro la nota del 1 nov: al pie, «Ese día: 4 tareas hechas · 3 hábitos cumplidos».

## Decisiones

| Tema | Decisión | Origen |
|---|---|---|
| Tipos | `daily` (una por `day` de Lima, sin título) y `page` (título 1–120, área de vida opcional, fijable). | Owner (las dos en v1) |
| Unicidad del día | Índice único parcial `(day) WHERE kind = 'daily' AND deleted_at IS NULL`. Crear la nota del día es un *upsert* bajo el lock `(9000, hashtext('notes:daily:' \|\| day))`. Una nota del día borrada no impide escribir otra ese día. | Autónoma |
| Guardado | Automático, 1 s después de la última tecla y al salir del campo o de la página (`visibilitychange`/`pagehide`). Uno en vuelo y el último pendiente (como `use-save-queue`). Indicador `aria-live` discreto: «Guardando…», «Guardado», «Sin guardar: …». Sin botón. | Owner |
| Versión | `version` entero; cada guardado manda la que editó y escribe solo si coincide (`UPDATE … WHERE version = $v`), devolviendo la nueva. Si no coincide: aviso «Cambió en otro dispositivo», el texto local queda como borrador y se ofrece «Ver la versión guardada» o «Quedarme con la mía» (sobrescribe con la versión actual). | Autónoma (supuesto 6) |
| Edición y lectura | La nota se ve renderizada; tocar el texto, «Editar» o `E` la pasa a un `textarea` (el mismo saneo y contador que proyectos) y «Listo» o Esc vuelven a la vista. Una nota vacía (o la de hoy sin texto) se abre directo en edición. Las acciones de línea (convertir, casillas de tareas) viven en la vista. | Autónoma para revisar con el owner |
| Enlaces | Formato `[[type:uuid\|Nombre]]` con `type` ∈ `note, project, task, habit, goal, learning`. El nombre guardado es solo respaldo (sin `[`, `]`, `\|` ni saltos). Un enlace con id mal formado o tipo desconocido se dibuja como texto. | Owner (lista de tipos) |
| Selector `[[` | Al escribir `[[` + texto, una lista (`role="listbox"`, combobox ARIA en el `textarea`) aparece **debajo del campo** (no junto al cursor: estable con el teclado del iPhone), con hasta 8 resultados agrupados por tipo y por nombre; flechas, Enter, Tab y Esc; toque en el celular. Elegir reemplaza `[[texto` por el enlace completo y deja el cursor después. | Autónoma |
| Backlinks | Se calculan al leer: notas vivas cuyo cuerpo contiene `[[type:<id>\|`. Sin tabla de enlaces (no hay estado derivado que pueda desincronizarse; para un usuario y miles de notas, el `LIKE` alcanza; si pasara de 5 000 notas se agrega un índice o tabla). La nota muestra «Enlazada desde»; proyecto, tarea, hábito, meta y frente muestran «Aparece en N notas» con la lista (fecha o título). Sin menciones, la sección no sale. | Owner (backlinks); autónoma (sin tabla) |
| Línea → tarea | En la vista, cada ítem `- [ ] texto` (casilla vacía, sin enlace dentro) muestra «Convertir en tarea». La acción recibe la nota, su versión, el índice del ítem y su texto: si la nota cambió, «Cambió mientras tanto», sin escribir. En una transacción crea la tarea en la bandeja (título = texto, sin interpretar fechas) por el contrato de `tasks` y reemplaza la línea por `- [[task:<id>\|texto]]`. «Deshacer» borra (lógico) esa tarea y devuelve la línea, solo si la nota sigue en la versión que dejó. | Owner |
| Casilla de tarea | Un ítem de lista que empieza con `[[task:…]]` se dibuja con la casilla del estado real de la tarea. Marcarla completa la tarea con la acción de `tasks` (recurrencia incluida) y su «Deshacer»; desmarcar una tarea hecha usa el «Deshacer»/reabrir que `tasks` ya expone. Una tarea borrada se ve como texto tachado «(eliminada)». | Owner (el estado vive en la tarea) |
| Búsqueda | Columna generada `search tsvector` con la configuración `notes_spanish` (copia de `spanish` con `unaccent`) sobre título + cuerpo, donde los enlaces se reemplazan por su nombre; índice GIN. La consulta se arma en el servidor: palabras del texto (letras y números, máx. 8), cada una con prefijo (`:*`), unidas con `&`. Orden por `ts_rank` y fecha. Fragmento con `ts_headline` y marcadores propios (nunca HTML de Postgres) que se dibujan con `<mark>`. Mínimo 2 caracteres. | Owner (solo Notas; texto completo) |
| Captura «Nota» | Tercer proveedor de la captura rápida, tras Tarea y Gasto. Una línea de texto (1–500, sin saltos): añade `- HH:MM texto` (hora de Lima) al final de la nota de hoy (crea la nota si no existe), bajo el lock del día. «Deshacer» quita esa línea solo si la nota sigue en la versión que dejó; si no, «Cambió mientras tanto». | Owner |
| Pie «Ese día» | En la nota del día: «Ese día: 4 tareas hechas · 3 hábitos cumplidos», con datos de los contratos de `tasks` y `habits` (completadas en ese día de Lima; hábitos cumplidos ese día). Sin nada, el pie dice «Sin registros ese día» en tono neutro. Nunca conteos de lo que faltó. | Owner |
| Lista | `/notes`: buscador arriba, «Nota de hoy» y «Nueva nota»; filtro «Todas · Diario · Notas» y área de vida; fijadas primero; luego por última edición, de 30 en 30 («Ver más»). Fila: título (o fecha larga para el diario), extracto de una línea y fecha relativa. Vacío: «Escribe lo que pasó hoy» con «Nota de hoy». | Autónoma |
| Navegación del diario | La nota del día tiene «Día anterior» / «Día siguiente» (hasta hoy) y un selector de fecha; un día sin nota se abre vacío, en edición. | Autónoma |
| Hoy | Tecla «Nota de hoy» en la cabecera de `/` (junto al saludo o en «Día completo»), sin sección nueva. Si la nota de hoy tiene texto, la tecla dice «Seguir la nota de hoy». | Owner |
| Tono | Mismas cadenas prohibidas de `goals`, `weekly-review`, `household` y `learning`; una prueba recorre el copy. | Principios UX 6 |

## Pantallas

- **`/notes`:** ver «Lista» en Decisiones. Buscar reemplaza la lista por los resultados (`?q=`, recargable); limpiar la búsqueda vuelve a la lista y devuelve el foco al campo.
- **Nota del día `/notes/[day]`** (`YYYY-MM-DD`; fuera de formato o futura → 404): cabecera con la fecha larga («Lunes 3 de noviembre»), «Día anterior/siguiente», indicador de guardado, menú «Eliminar»; cuerpo (vista o edición); «Enlazada desde»; pie «Ese día».
- **Nota de conocimiento `/notes/[id]`** (uuid): título editable en el sitio, área, «Fijar», menú «Eliminar»; cuerpo; «Enlazada desde».
- **Nueva nota:** «Nueva nota» crea la fila al escribir el título (una hoja con título y área; < 10 s en el celular) y abre la nota en edición.
- **Sección «Aparece en»** en `/projects/[id]`, `/tasks/[id]`, `/habits/[id]`, `/goals/[id]` y `/learning/[id]`, al final de la página.
- **Captura «Nota»:** hoja con un campo y «Añadir a la nota de hoy».

Principios aplicables (`docs/principios-ux.md`): registro en un toque (captura, casilla), UI optimista con «Deshacer», foco restaurado y `aria-disabled` con guarda, toasts que no tapan el control enfocado, 320 px sin scroll horizontal, movimiento reducido.

## Modelo de datos

Una tabla, borrado lógico. Migraciones **aditivas** (N1: tabla; N4: extensión, configuración de búsqueda y columna generada).

```ts
notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),                       // CHECK: daily | page
  day: date("day"),                                   // presente si y solo si kind = 'daily'
  title: text("title"),                               // 1–120, presente si y solo si kind = 'page'
  body: text("body").notNull().default(""),           // ≤ 50 000
  areaId: uuid("area_id").references(() => lifeAreas.id, { onDelete: "restrict" }), // solo page
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),                         // solo page
  version: integer("version").notNull().default(1),
  createdAt, updatedAt,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
// ÚNICO PARCIAL: (day) WHERE kind = 'daily' AND deleted_at IS NULL
// N4: search tsvector GENERATED ALWAYS AS (to_tsvector('notes_spanish', …)) STORED + GIN
```

- **`CHECK`:** `kind` permitido, `day`/`title` según el tipo, longitudes, `area_id` y `pinned_at` nulos en `daily`, `version ≥ 1`. NUL y controles bidireccionales se rechazan en Zod (la misma función de saneo que proyectos, con el límite propio).
- **Búsqueda (N4):** `CREATE EXTENSION IF NOT EXISTS unaccent` y `CREATE TEXT SEARCH CONFIGURATION notes_spanish (COPY = spanish)` con `unaccent` antes de `spanish_stem`. Comprobar que el Postgres de `embedded-postgres` (local) y el de CI traen `unaccent`; si el local no lo trae, la prueba de integración de búsqueda corre solo en CI y se anota en HANDOFF.
- **Bloqueo:** `NOTES_ADVISORY_SPACE = 9000`. Crear la nota del día y la captura toman `(9000, hashtext('notes:daily:' || day))` como **primer** lock. Guardar una nota existente no toma lock (la versión decide).
- **Exportación:** `notes` entra a `EXPORTABLE_TABLES` (sin la columna generada) y al respaldo. Prettier sobre el snapshot de Drizzle tras `pnpm db:generate`.
- **FK a `life_areas`:** como en otros módulos (`core` es dependencia directa).

## Contratos

- **Fuentes de enlace** (`src/modules/notes/contracts.ts` define `NoteLinkSource`; la raíz de composición `src/lib/note-link-sources.ts` las nombra): cada módulo expone, sin importar `notes`, `search(db, q, limit)` → `{ id, name, hint }[]` y `resolve(db, ids)` → `{ id, name, href, deleted, done? }[]` (`done` solo en tareas). `notes` resuelve los enlaces de una nota en una consulta por tipo.
- **Backlinks hacia los módulos:** `src/lib/note-extensions.tsx` exporta `<NoteMentions type id />` (Server Component) que cada página de detalle dibuja al final; las páginas importan de `@/lib`, nunca de `notes`.
- **`notes` → `tasks`:** `createInboxTask(tx, title)` (dentro de la transacción de la nota), `undoInboxTask(tx, id)`, y las acciones existentes de completar y deshacer para la casilla.
- **`notes` → `tasks`/`habits` (pie):** `countTasksCompletedOn(db, day)` y `countHabitsDoneOn(db, day)`, funciones de datos puras que no importan `notes`.
- **`today` → `notes`:** `getTodayNoteState(db, day)` → `{ hasText }` para el texto de la tecla, vía `src/lib`.
- **Captura:** `notesCaptureProvider` en `src/lib/capture-providers.tsx` (orden: Tarea, Gasto, Nota).
- **`core`:** la tecla `N` en `shortcuts.ts` (único cambio en `core`, como la `C` de captura).
- **Nadie más importa `notes`:** regla de ESLint nueva, con las raíces de composición de `src/lib` como única excepción.

## Comandos y estructura

Los mismos de `SPEC-core`; sin variables de entorno ni servicios externos.

```
src/modules/notes/ → module.ts, routes.ts, lock-keys.ts, db/schema.ts, contracts.ts,
                     note-input.ts (Zod y saneo), note-links.ts (puro: parsear, reemplazar, backlinks),
                     note-lines.ts (puro: ítems de lista, convertir, añadir línea), notes.ts (datos),
                     actions.ts, search.ts, copy.ts, revalidate.ts, export.ts, capture-provider.tsx,
                     components/ (lista, editor con selector, vista, pie, indicador de guardado)
src/app/(app)/notes/page.tsx, src/app/(app)/notes/[key]/page.tsx   (key = día o uuid)
src/lib/note-link-sources.ts, src/lib/note-extensions.tsx, src/lib/markdown/ (plugin de [[enlaces]])
src/modules/{projects,tasks,habits,goals,learning}/note-link-source.ts (+ conteos del pie en tasks y habits)
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | Saneo (50 000, NUL, bidi, CRLF), parseo y reemplazo de `[[…]]` (ids inválidos, tipos desconocidos, nombres con `]`/`\|`, enlaces dentro de código que no cuentan), ítems de lista y conversión por índice, añadir línea con hora de Lima (cruce de medianoche), armado de la consulta de búsqueda (comillas, operadores de `tsquery`, 8 palabras), cola de guardado y conflicto de versión, combobox del selector (teclado y foco), copy sin cadenas prohibidas, componentes de lista, nota, pie y sección «Aparece en» |
| Integración | `CHECK` con inserts crudos, una sola nota del día con dos *upserts* a la vez (control positivo: días distintos crean dos), versión que rechaza un guardado viejo, convertir en tarea y su «Deshacer» exacto, captura con dos solicitudes a la vez (dos líneas, ninguna perdida), backlinks (borrada no cuenta), búsqueda (acentos, prefijo, enlace por su nombre, inyección de operadores), conteos del pie, autorización de cada acción, exportación |
| E2E | **Un solo spec nuevo** (`notes.spec.ts`): nota de hoy desde Hoy, escribir y ver «Guardado» tras recargar, `[[` y elegir un proyecto, backlink en el proyecto, convertir una línea en tarea y marcarla, buscar; axe en 0 en ambos temas y 320 px (con `afterSaveSettled`); una captura con `expectScreenshot`. Entrada en `SPEC_MODULES` con `["notes", "today", "projects", "tasks"]`. |

Local: solo el gate liviano; integración nueva de a un archivo (`rtk proxy pnpm test:integration <archivo>`). Lecciones aplicables: una entrada de navegación nueva cambia `e2e/home.spec.ts` y todas las capturas con la barra (dispatch de `update-screenshots.yml` tras el push); raíces de composición mockeadas en pruebas de página (`@/lib/note-extensions` en las cinco páginas de detalle); Drizzle imprime columnas sin tabla en subconsultas crudas; tiempos con reloj de prueba decididos antes de escribir la función.

## Límites

- **Siempre:** las de `SPEC-core` y las lecciones de `CLAUDE.md`: `ownerAction(schema, handler)` y `requireOwner()`, locks de dos claves como primer lock, nada se borra físicamente, «Deshacer» exacto con el id y la versión que se dejaron, foco restaurado y `aria-disabled`, temporizadores limpiados (el del guardado incluido), logs con `describeError` (nunca el texto de una nota), Markdown solo por `src/lib/markdown/` (nunca `rehype-raw`, nunca imágenes cargadas).
- **Preguntar primero:** dependencias nuevas, cambios en `ci.yml` o en la configuración de build, tocar otros módulos más allá de sus contratos y del hueco «Aparece en», un aviso nuevo en `reminders`, escribir en producción fuera de migraciones aditivas.
- **Nunca:** texto de culpa; que un módulo importe `notes`; HTML de `ts_headline` sin pasar por los marcadores propios; seguir o precargar URLs de una nota desde el servidor; el contenido de las notas en logs, errores o capturas de E2E con datos reales; PNG hechos en macOS; correr build, integración completa o E2E locales.

## Criterios de éxito

1. **Escribir:** «Nota de hoy» abre la nota del día en edición; lo escrito queda guardado sin botón y sobrevive a recargar; dos pestañas no se pisan (la segunda ve «Cambió en otro dispositivo» y no pierde su texto).
2. **Enlaces:** `[[Ru` + elegir deja un enlace que abre la entidad, con su nombre actual tras renombrarla; la entidad muestra «Aparece en N notas».
3. **Línea → tarea:** convertir crea la tarea en la bandeja en 1 toque y la casilla de la nota refleja y cambia su estado; «Deshacer» deja todo como estaba.
4. **Buscar:** «polit» encuentra «políticas»; un texto con `&`, `!` o `:` no rompe la consulta.
5. **Captura y pie:** la captura «Nota» añade la línea con la hora a la nota de hoy y su «Deshacer» la quita; el pie muestra los conteos del día.
6. **Calidad:** CI en verde; axe en 0 en ambos temas; 320 px sin scroll horizontal; `notes` en `pnpm db:export` y el respaldo; HANDOFF, `todo` y mapa actualizados tras cada merge; Checkpoint en producción con datos `[QA]` borrados después.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md`. Un implementador a la vez (gate liviano). Un solo E2E nuevo (N4).

- **N1 — Notas y editor:** migración de `notes`, manifiesto y entrada «Notas», lista, nota del día y de conocimiento, edición con guardado automático y versión, eliminar con «Deshacer», fijar y área, «Nota de hoy» en Hoy y la tecla `N`, exportación, regla de ESLint. Sin E2E.
- **N2 — Enlaces:** plugin `[[…]]` del renderizador, fuentes de enlace de los seis tipos, selector en el editor, «Enlazada desde» y la sección «Aparece en» en las cinco páginas de detalle. Sin E2E.
- **N3 — Línea → tarea, captura y pie:** convertir y la casilla viva, proveedor «Nota» de la captura rápida, pie «Ese día». Sin E2E.
- **N4 — Búsqueda y E2E:** migración de búsqueda, buscador de `/notes` con fragmentos, el único E2E (`notes.spec.ts`).
- **N5 — Cierre:** Checkpoint en producción (Chrome del owner, datos `[QA]`), retrospectiva, backlog, mapa y HANDOFF.

## Decisiones autónomas para revisar con el owner

La vista renderizada con «Editar» (en vez de editar siempre), el selector `[[` debajo del campo y no junto al cursor, backlinks sin tabla de enlaces, la navegación del diario por día anterior/siguiente, la tecla `N`, el orden «Tarea · Gasto · Nota» de la captura y el texto «Seguir la nota de hoy».
