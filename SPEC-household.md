# Spec: household

> Módulo `household` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` y `tasks` · Estado: **APROBADO v1.0** (2026-10-14; el owner aprobó la spec y respondió las preguntas abiertas; la 4 por recomendación del agente).

## Objetivo

Que el Hogar de Notion viva en brahua-os y se use desde el celular: **saber qué toca limpiar, qué falta comprar y qué cocinar**, sin tres bases de datos sueltas. Ninguna parte se cierra con culpa: lo que no se hizo se reprograma, no se acumula como deuda (principios UX 7 y 8).

Alcance v1 (decisión del owner, 2026-10-14: las tres partes entran):

- **Limpieza semanal = tareas recurrentes de `tasks`** (decisión del owner). No hay tabla de limpieza ni recurrencia nueva: cada limpieza es una tarea con la etiqueta `limpieza` y una etiqueta de zona. Aparece también en Hoy, en `/tasks` y en el resumen de la mañana de `reminders` sin tocar esos módulos. `household` aporta la **vista por zona y por día** y el formulario de alta.
- **Lista de compras agrupada por categoría** (recomendación del agente, **aprobada por el owner el 2026-10-14**): lista viva con las secciones del súper (Carnes, Verduras…), «Comprado» con un toque, y **sugerencias de productos ya comprados** al escribir. Sin catálogo aparte: el producto que ya compraste queda «guardado» y se vuelve a añadir con un toque.
- **Recetario con enlace** (decisión del owner): nombre, tipo de comida, días sugeridos y enlace de referencia, como en Notion. Sin ingredientes, pasos ni plan semanal.

Fuera de este módulo: mascotas (app aparte), ingredientes y su paso a la lista de compras, plan semanal de comidas, precios y presupuesto de compras (eso es `finance`), inventario con cantidades en casa, compartir la lista con otra persona (la app es de un solo usuario), escáner de códigos, avisos nuevos de `reminders` (la limpieza ya entra como tarea), importación obligatoria.

### Supuestos (corríjanme ahora o sigo con estos)

1. Zonas de limpieza = las del Notion (Dormitorio principal, Oficina Antonella, Baño, Oficina Josue, Cocina/Lavandería, Balcón, Sala/Comedor, Todas) como **sugerencias**; se puede escribir una zona nueva.
2. Categorías de compra = las 8 del Notion como lista **fija en código** (Carnes, Verduras, Frutas, Lácteos, Especerías, Productos naturales, Limpieza, Otros); un producto tiene **una** categoría (en Notion eran varias). Editar categorías va al backlog.
3. Una limpieza «cuenta desde la última vez que se hizo» (regla de `SPEC-tasks`): mensual y trimestral se cuentan desde que se completan; semanal con día fijo usa «ciertos días de la semana».
4. Solo se importan las **limpiezas** desde Notion, en el corte H4; productos y recetas se cargan a mano (decisión del owner, 2026-10-14).
5. Moneda, cantidades en casa y precios no existen aquí.

### Historias de usuario

1. Abro «Hogar → Limpieza» y veo **por zona** lo que toca esta semana: «Baño · Limpiar inodoro · Cada semana, lunes · toca hoy». Marco «Hecho» con un toque; sale con fundido, la siguiente fecha se programa sola y aparece «Deshacer».
2. Cambio a «Por día» y veo lunes a domingo; lo que quedó de días anteriores aparece arriba como «De antes», sin rojo ni la palabra «atrasada».
3. Añado «Trapear sala» con zona «Sala/Comedor», frecuencia «Cada 2 semanas» y primera fecha; en Hoy aparece el día que toca porque es una tarea.
4. En el súper abro «Compras» y recorro la lista por sección. Marco «Comprado» cada producto; los comprados bajan a «Comprados».
5. Escribo «lec…» y me sugiere «Leche» (ya la compré antes, con su categoría y cantidad). La toco y entra a la lista.
6. Al llegar a casa toco «Terminé la compra»: lo comprado vuelve a «guardado» (queda para sugerir) y la lista queda lista para la próxima. «Deshacer» lo devuelve exacto.
7. En «Recetas» veo primero «Para hoy» (las del día de la semana de hoy) y debajo todas, con filtros por tipo (Desayuno…Cena) y día. Toco una y abro su enlace.
8. Añado una receta con nombre, tipo(s), día(s) y enlace; la edito o la quito con «Deshacer».

## Decisiones

| Tema | Decisión | Origen |
|---|---|---|
| Limpieza | Es una tarea de `tasks` con etiqueta `limpieza` + una de zona (`zona: baño`). **No** hay tabla propia ni vínculo por id: cada ocurrencia nueva es otra fila (la recurrencia copia las etiquetas), así que la etiqueta es el único vínculo estable. | Owner, 2026-10-14; hallazgo del código (`SPEC-tasks` «Recurrencia») |
| Frecuencias | Diaria = cada 1 día · Semanal = «ciertos días» (uno o más) · Quincenal = cada 2 semanas · Mensual = cada 1 mes · Trimestral = cada 3 meses. Sin reglas nuevas. | Mapeo de `Periodicidad` de Notion a la recurrencia existente |
| Zonas | Etiquetas `zona: <nombre>` (≤ 30 caracteres). La lista de zonas de la vista es la de etiquetas de zona en uso más las sugeridas. Una tarea sin etiqueta de zona sale en «Sin zona». | Supuesto 1 |
| Salir de la vista | Quitar la etiqueta `limpieza` desde `/tasks` saca la tarea de «Hogar»: es la forma de «ya no toca». «Quitar» desde Hogar elimina la tarea (borrado lógico con «Deshacer») y corta la serie. | Recomendación del agente, aprobada por el owner (2026-10-14) |
| Compras: estados | Un producto está `guardado` (idle), `en la lista` (needed) o `comprado` (bought). Añadir un nombre que ya existe lo pasa a `en la lista` en vez de duplicarlo (único por nombre sin distinguir mayúsculas ni tildes). | Recomendación del agente |
| Compras: cierre | «Terminé la compra» pasa todos los `comprados` a `guardado` en un solo `UPDATE`; «Deshacer» lleva los ids y `bought_at` y solo revierte los que siguen igual. | Patrón de «Deshacer» exacto (`goals`) |
| Compras: cantidad | Texto libre ≤ 30 («2 kg», «1 docena»); sin unidades ni sumas. | Notion lo tenía como texto |
| Recetas: enlace | Solo `http`/`https`, ≤ 2000 caracteres; se muestra el dominio y abre en pestaña nueva con `rel="noopener noreferrer"`. No se descarga ni se previsualiza. | Seguridad: URL de entrada del owner, nunca se sigue desde el servidor |
| Recetas: días y tipos | Tipos: Desayuno, Media mañana, Almuerzo, Media tarde, Merienda, Cena (≥ 0). Días ISO 1–7 (≥ 0). «Para hoy» = las que incluyen el día de hoy en Lima. | Notion |
| Hoy | `household` no añade sección a Hoy en v1: la limpieza ya sale como tareas. «Receta de hoy» queda para después. | Reutilizar contratos antes que crear superficies |
| Tono | «Toca» y «De antes», nunca «atrasada», «pendiente de culpa» ni conteos de deuda; mismas cadenas prohibidas de `goals` y `weekly-review`. | Principios UX 7 y 8 |
| Navegación | `/household`, módulo «Hogar» (`navOrder` 67), sin atajo numérico (1–8 ocupados); en el celular va bajo «Más». Pestañas con `?vista=limpieza\|compras\|recetas`; por defecto, Limpieza. | Convención |

## Pantallas

- **`/household?vista=limpieza`:** conmutador «Por zona / Por día». Por zona: una sección por zona (nombre, cantidad que toca esta semana) con sus limpiezas ordenadas por próxima fecha; cada fila de 44 px muestra título, «Cada semana, lunes» y «toca hoy / mañana / el jueves 16», con la tecla «Hecho» (`aria-disabled` mientras guarda, foco restaurado). Por día: «De antes», hoy, y cada día hasta el domingo. «Añadir limpieza» abre una hoja: título, zona (sugeridas + escribir), frecuencia, día(s) si es semanal y primera fecha. Tocar la fila abre el detalle de la tarea en `/tasks`. Vacío: «Nada que limpiar esta semana.»
- **`?vista=compras`:** campo «Añadir producto» arriba (con sugerencias de `guardado`; sin coincidencia pide categoría, por defecto «Otros»); secciones por categoría en orden de recorrido del súper; filas de 44 px con «Comprado» (casilla), nombre y cantidad (editable). Abajo, «Comprados» (plegado) con «Terminé la compra». Menú por fila: «Quitar de la lista», «Olvidar producto». Vacío: «La lista está vacía.»
- **`?vista=recetas`:** «Para hoy», filtros por tipo y día (`?tipo=`, `?dia=`), lista con nombre, chips de tipo, días y dominio del enlace; «Añadir receta» abre una hoja con nombre, tipos, días y enlace. Vacío: «Aún no hay recetas.»

Principios aplicables (`docs/principios-ux.md`): registro en un toque, sin castigo, foco restaurado, toasts que no tapan el control enfocado, escenas de una mano (el súper).

## Modelo de datos

La limpieza **no tiene tablas**. Dos tablas nuevas, ambas de borrado lógico:

```ts
householdProducts = pgTable("household_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                       // 1–80, normalizado
  nameKey: text("name_key").notNull(),                // minúsculas sin tildes: unicidad y sugerencias
  category: text("category").notNull().default("otros"), // CHECK: las 8 de la lista fija
  quantity: text("quantity"),                         // 1–30, opcional
  status: text("status").notNull().default("needed"), // CHECK: idle | needed | bought
  boughtAt: timestamp("bought_at", { withTimezone: true }), // solo si status = 'bought'
  createdAt, updatedAt,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
// ÚNICO PARCIAL: (name_key) donde deleted_at IS NULL

householdRecipes = pgTable("household_recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                       // 1–120
  mealTypes: text("meal_types").array().notNull().default([]), // CHECK: ⊆ los 6 tipos
  weekdays: smallint("weekdays").array().notNull().default([]), // CHECK: ⊆ 1..7
  url: text("url"),                                   // http/https ≤ 2000, opcional
  createdAt, updatedAt,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
```

- **`CHECK`:** longitudes, `status`/`category`/tipos permitidos, `bought_at` presente si y solo si `status = 'bought'`, `url ~ '^https?://'`.
- **Bloqueo:** `HOUSEHOLD_ADVISORY_SPACE = 7000`; añadir un producto toma `(7000, hashtext(name_key))` como **primer** lock de la transacción (dos claves). Dos añadidos del mismo nombre a la vez dejan una fila; el índice único es la red de seguridad.
- **Exportación:** ambas tablas entran a `EXPORTABLE_TABLES` y al respaldo. Migración **aditiva**; Prettier sobre el snapshot de Drizzle tras `pnpm db:generate`.

## Contratos

- **`household` → `tasks`** (nuevos, en `src/modules/tasks/contracts.ts`; `household` solo importa `core` y esos contratos y las rutas de `tasks`): `listTasksByTag(tag, now)` (pendientes visibles con fecha, regla en palabras, etiquetas y área, en una consulta), `createTaskWithTags(input)` (título, primera fecha, recurrencia y etiquetas, con la misma validación y el mismo lock de la acción de creación) y la finalización por `completeTask`, que ya trae el «Deshacer» que borra la siguiente. Si algo de esto ya existe con otro nombre, el plan lo reutiliza en vez de duplicarlo.
- **Nadie importa `household`:** regla de ESLint nueva (como `goals`). v1 no expone contratos de salida.

## Comandos y estructura

Los mismos de `SPEC-core`; sin variables de entorno ni servicios externos.

```
src/modules/household/ → module.ts, routes.ts, db/schema.ts, contracts.ts (vacío en v1),
                         cleaning-*.ts (zona, frecuencia→recurrencia, agrupar por día/zona: puros),
                         products-*.ts, recipes-*.ts (Zod, dominio, acciones, queries, revalidate, copy), components/
src/app/(app)/household/page.tsx
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | Mapa frecuencia → recurrencia (las 5, y semanal con varios días), agrupación por zona y por día (lunes/domingo, «De antes», medianoche de Lima, cambio de mes y año), normalización de zona/nombre/URL (`javascript:` rechazada), orden de categorías, copy (**ninguna cadena prohibida**), componentes de cada vista |
| Integración | Las dos tablas (`CHECK` con inserts crudos, único parcial), añadir producto concurrente (dos a la vez → una fila, con control positivo de dos nombres distintos), «Terminé la compra» y su «Deshacer» exacto (un producto vuelto a marcar a mano no se pisa), contratos de `tasks` (listar por etiqueta, crear con etiquetas, la siguiente ocurrencia conserva `limpieza` y zona), autorización de cada acción, exportación |
| E2E | **Un solo spec nuevo** (`household.spec.ts`, en el corte H3): crear una limpieza, marcarla y ver la siguiente; añadir un producto con sugerencia y «Terminé la compra»; añadir una receta y filtrar; axe en 0 en ambos temas y 320 px (con `afterSaveSettled`); una captura con `expectScreenshot`. Entrada nueva en `SPEC_MODULES` (`scripts/e2e-affected.mjs`) con `["household", "tasks"]` y etiquetas `@today-tasks`, porque crea tareas con fecha de hoy (lección de `today`). |

Local: solo el gate liviano; archivos de integración nuevos de a uno (`rtk proxy pnpm test:integration <archivo>`). Lecciones aplicables: agregar una entrada de navegación cambia otras E2E y capturas (`e2e/home.spec.ts` cuenta enlaces; dispatch de `update-screenshots.yml` tras el push), raíces de composición mockeadas en pruebas de página, `ON DELETE RESTRICT` = `23001`.

## Límites

- **Siempre:** las de `SPEC-core` y las lecciones de `CLAUDE.md`: `ownerAction(schema, handler)` y `requireOwner()` en cada página, locks de dos claves como primer lock, nada se borra físicamente, «Deshacer» exacto con el id que se creó o cambió, foco restaurado y `aria-disabled`, temporizadores limpiados, logs con `describeError`, validar listas de ids como conjuntos.
- **Preguntar primero:** dependencias nuevas, cambios en `ci.yml` o en la configuración de build, tocar `tasks` más allá de sus contratos, un aviso nuevo en `reminders`, escribir en producción fuera de migraciones aditivas, importar datos reales.
- **Nunca:** texto de culpa o «atrasadas»; que otro módulo importe `household`; que `household` lea tablas de `tasks` directo; seguir o descargar el enlace de una receta desde el servidor; secretos o datos reales del owner en el repo; PNG hechos en macOS; correr build, integración completa o E2E locales.

## Criterios de éxito

1. **Limpieza:** una limpieza creada en Hogar aparece en Hoy el día que toca; «Hecho» programa la siguiente (con `limpieza` y su zona) y «Deshacer» revierte exacto; las cinco frecuencias producen la fecha esperada.
2. **Vistas:** «Por zona» y «Por día» listan las mismas limpiezas pendientes; una sin zona sale en «Sin zona»; ninguna palabra de culpa.
3. **Compras:** añadir, marcar «Comprado», «Terminé la compra» y «Deshacer» funcionan con una mano en 320 px; añadir un nombre existente no duplica; dos añadidos a la vez dejan una fila.
4. **Recetas:** «Para hoy» sigue el día de Lima; una URL que no sea `http(s)` se rechaza; los filtros se mantienen en la URL.
5. **Fronteras:** `household` solo importa `core` y los contratos de `tasks`; nadie lo importa (ESLint).
6. **Calidad:** CI en verde; axe en 0 en ambos temas; movimiento reducido respetado; 320 px sin scroll horizontal; las dos tablas en `pnpm db:export` y el respaldo; HANDOFF, `todo` y mapa actualizados tras cada merge.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec. Un implementador a la vez (gate liviano). Un solo E2E nuevo (H3).

- **H1 — Cimientos y Limpieza:** manifiesto y entrada «Hogar», contratos de `tasks`, vistas por zona y por día, formulario de alta, «Hecho»/«Quitar»; regla de ESLint. Sin tablas. Sin E2E.
- **H2 — Compras:** migración de `household_products`, añadir con sugerencias, «Comprado», «Terminé la compra» y su «Deshacer», menú por fila. Sin E2E.
- **H3 — Recetas y E2E:** migración de `household_recipes`, vista con «Para hoy» y filtros, hoja de alta/edición. El único E2E (`household.spec.ts`).
- **H4 — Cierre:** importación de las limpiezas desde Notion (`pnpm db:household:import`: respaldo previo, una transacción, confirmación; imprime conteos y nombres, nunca datos fuera del repo), retrospectiva, backlog, mapa y HANDOFF; Checkpoint en producción (Chrome del owner, datos `[QA]`).

## Preguntas abiertas

Ninguna: el owner respondió el 2026-10-14: importar **solo la limpieza**; lista de compras como se propone, con las 8 categorías fijas; la receta de hoy queda fuera de v1; «Quitar» elimina la tarea con «Deshacer» (recomendación del agente, que el owner aceptó al pedirla).
