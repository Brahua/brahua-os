# Spec: learning

> Módulo `learning` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core`, `projects` y `today` (sección nueva) · Estado: **APROBADA v1.0** (2026-10-29; entrevista y respuestas del owner el mismo día).

## Objetivo

Que estudiar deje de depender de la memoria y de las ganas del día: **saber qué sigue, hacer pocas cosas a la vez, verlas avanzar y sostener un ritmo semanal**. El owner estudia certificaciones (AWS), cursos de plataformas (Platzi, Udemy), libros técnicos e idiomas, y hoy le fallan las cuatro cosas: la constancia, saber por dónde seguir, tener demasiados frentes abiertos y ver el avance (respuestas del owner, 2026-10-29).

- **Frente de estudio** = una certificación, un curso, un libro o una práctica (idioma u otra que se mide en tiempo).
- **Temario completo** (decisión del owner): cada frente tiene su lista de pasos (clases, capítulos, temas), que se pega de una vez y se va marcando. **El siguiente paso sale solo:** el primero sin marcar. Una práctica no tiene temario.
- **Pocos frentes a la vez** (decisión del owner): **como máximo 2 «En curso»**. El resto queda «En espera», sin culpa; para empezar otro hay que pausar o terminar uno.
- **Tiempo con cronómetro y a mano** (decisión del owner): «Estudiar» inicia un cronómetro que sobrevive a cerrar la app; si se olvidó, se anotan los minutos después.
- **Meta semanal de horas por frente** (decisión del owner), opcional: «1 h 20 de 3 h esta semana». Sin hábito enlazado (decisión del owner: solo la meta de horas).
- **Fecha objetivo opcional** (decisión del owner), p. ej. el examen de AWS: «Para llegar al 15 dic: ~4 pasos por semana». Nunca «atrasado».
- **En Hoy, «Sigue con»** (decisión del owner): una tarjeta por frente en curso con su siguiente paso, «Estudiar» (arranca el cronómetro) y lo de la semana.
- **Enlace a proyecto** (decisión del owner): un frente puede pertenecer a un proyecto (p. ej. «Preparación profesional: ruta AWS + IA aplicada») y sus pasos cuentan en el avance del proyecto. Como `goals` ya mide proyectos, **frente → proyecto → meta** cubre las metas sin un enlace nuevo (aclarado con el owner, 2026-10-29).

Fuera de este módulo: hábito enlazado («Estudiar»), fuente nueva en `goals`, Pomodoro con avisos, importación (el owner empieza de cero), sincronizar con Platzi/Udemy o leer sus páginas, notas de estudio (`notes`), tarjetas de repaso, avisos nuevos de `reminders`, registrar una sesión por Telegram (backlog), cuidar la «salud» del estudio con estadísticas largas (heatmap anual: backlog).

### Supuestos (corríjanme ahora o sigo con estos)

1. **Nombre en la app: «Aprendizaje»** (como el área «Aprendizaje y Desarrollo profesional»); ruta `/learning`; en el celular va bajo «Más», como Hogar.
2. **Temario plano:** una lista de pasos en orden, sin secciones ni subpasos. Pegar varias líneas crea un paso por línea (vacías fuera; hasta 500 pasos por frente). Se pueden añadir, renombrar, reordenar y quitar pasos después.
3. **Marcar un paso no exige sesión** y **una sesión no exige paso:** son dos registros independientes, cada uno en un toque.
4. **Un solo cronómetro a la vez** en toda la app. Iniciar otro frente detiene y guarda el que corría (con aviso y «Deshacer»).
5. **Semana lunes–domingo en Lima**, como el resto de la app. Una sesión cuenta en la semana del día en que **empezó**.
6. **Un frente terminado no cuenta en el límite** y queda en «Terminados» con sus horas totales; se puede reabrir (si hay lugar entre los 2 en curso).

### Historias de usuario

1. Creo «AWS Solutions Architect Associate» (certificación), pego las 40 clases del curso, le pongo «3 h por semana», fecha objetivo 15 de diciembre y lo enlazo al proyecto «Ruta AWS + IA». Queda «En curso».
2. En Hoy veo «Sigue con · AWS SAA · Clase 13: IAM policies · 1 h 20 de 3 h». Toco «Estudiar»: arranca el cronómetro y la tarjeta muestra el tiempo corriendo.
3. Termino la clase: toco «Hecho» en el paso (pasa al 14 y la barra avanza a 13 de 40) y «Detener» el cronómetro: «Guardaste 42 min en AWS SAA», con «Deshacer».
4. Ayer estudié sin cronómetro: en el frente toco «Anotar tiempo», escribo 30 min y elijo «ayer».
5. Intento poner en curso un tercer frente: la app me dice «Ya tienes 2 en curso» y me ofrece pasar uno a «En espera». No hay error ni culpa.
6. En `/learning` veo mis 2 frentes en curso arriba (siguiente paso, barra, semana, ritmo a la fecha), «En espera» y «Terminados» plegados.
7. En el proyecto «Ruta AWS + IA» el avance sube cuando marco clases del frente enlazado.
8. Cuando marco el último paso, el frente ofrece «Terminar» con una celebración discreta (la de `core`, respetando movimiento reducido).

## Decisiones

| Tema | Decisión | Origen |
|---|---|---|
| Tipos | `certification`, `course`, `book`, `practice`. Solo `practice` no tiene temario (se mide en tiempo); los demás pueden no tenerlo aún (sin barra hasta que lo tengan). | Owner, 2026-10-29 (los cuatro tipos) |
| Estados | `active` («En curso»), `waiting` («En espera»), `done` («Terminado»). Borrar = `deleted_at` con «Deshacer». Sin estado «abandonado»: lo que no sigue va a «En espera». | Principios UX (sin culpa) |
| Límite | Como máximo **2** frentes `active`. Se valida en el servidor dentro de la transacción, después de tomar el lock `(8000, hashtext('learning:active'))`; la interfaz lo explica antes de enviar. | Owner, 2026-10-29 |
| Siguiente paso | El primer paso sin `done_at` por `position`. Sin temario: el frente muestra «Agrega el temario» (o nada, si es una práctica). | Owner (temario completo) |
| Avance | `pasos hechos / pasos` del frente. Desmarcar un paso es posible (con «Deshacer» al marcarlo). | Owner |
| Cronómetro | La sesión en curso es una fila con `ended_at` nulo (índice único parcial: una sola a la vez). El tiempo se calcula desde `started_at`; cerrar la app no lo detiene. Al detener, si pasaron **más de 4 h**, la hoja pide confirmar o corregir los minutos antes de guardar. | Owner (cronómetro y manual; umbral de 4 h aprobado el 2026-10-29) |
| Sesión manual | Minutos (1–600) y día (hoy por defecto, hasta 30 días atrás). | Owner |
| Meta semanal | Opcional por frente, en minutos (15–3000, la interfaz en horas y minutos). Texto: «1 h 20 de 3 h esta semana»; si se cumple, «Semana cumplida». Debajo de la meta no hay conteo de deuda ni rojo: solo lo que falta («Te faltan 1 h 40»). | Owner, 2026-10-29 |
| Ritmo a la fecha | Con fecha objetivo y temario: `pasos restantes / semanas restantes`, redondeado hacia arriba: «Para llegar al 15 dic: ~4 pasos por semana». Pasada la fecha: «La fecha pasó: ponle otra o quítala», sin color de alarma. | Owner; texto alineado con `goals` |
| Proyecto | `project_id` opcional. `learning` registra una **fuente de avance** en `projects` (`registerProgressSource`): **cada frente vale una unidad**, igual que una tarea, y aporta su porcentaje (pasos hechos / pasos; un frente terminado vale 1; uno sin temario o de práctica vale 0 hasta terminarlo). Un curso de 40 clases no tapa las tareas del proyecto. | Owner (enlace a proyecto; opción «su porcentaje, pesando como una tarea», 2026-10-29) |
| Hoy | Sección «Estudio» en `today` después de Tareas: una tarjeta por frente en curso (≤ 2) con siguiente paso, «Estudiar» / «Detener» y la semana. Sin frentes en curso, la sección no sale. | Owner, 2026-10-29 |
| Revisión semanal | En v1: el paso «Logros» de `weekly-review` muestra una cifra más, «Estudio: 3 h 20» (minutos de sesiones de la semana de Lima), y la cuenta para decidir «Una semana tranquila». Sin metas incumplidas ni comparaciones. | Owner (2026-10-29) |
| Tono | Mismas cadenas prohibidas de `goals`, `weekly-review` y `household` («atrasado», «fallaste», «deuda»…); una prueba recorre el copy. | Principios UX 6 y «Lo que no haremos» |

## Pantallas

- **`/learning`:** «En curso» arriba (hasta 2 tarjetas grandes: título, tipo, «Sigue con: …» con su «Hecho», barra «13 de 40», semana «1 h 20 de 3 h», ritmo a la fecha, «Estudiar»/«Detener» y el tiempo corriendo). Debajo, «En espera» y «Terminados» plegados (fila con título, avance y horas totales). «Nuevo frente» abre una hoja. Vacío: «¿Qué quieres aprender?» con «Crear mi primer frente».
- **Detalle `/learning/[id]`:** cabecera con estado y acciones («Poner en curso», «Pasar a espera», «Terminar», «Eliminar»), temario (lista con casillas, el siguiente destacado, «Pegar temario», añadir, renombrar, reordenar con teclado y arrastre, quitar), sesiones (lista por semana con totales, «Anotar tiempo», quitar con «Deshacer»), y ajustes (meta semanal, fecha objetivo, proyecto, enlace del curso).
- **Hoja «Nuevo frente»:** título, tipo, temario (área de texto: una línea por paso; oculta para práctica), meta semanal y fecha (plegadas), proyecto (plegado). Crear un frente en < 30 s en el celular sin temario y < 60 s pegándolo.
- **Hoy → «Estudio»:** la tarjeta de cada frente en curso (ver «Hoy» en Decisiones).

Principios aplicables (`docs/principios-ux.md`): registro en un toque (paso «Hecho», «Estudiar»), progreso visible (3, 4), límite de lo inconcluso (5: 2 en curso), sin castigo, UI optimista, foco restaurado y `aria-disabled` con guarda, toasts que no tapan el control enfocado, 320 px sin scroll horizontal.

## Modelo de datos

Tres tablas, todas con borrado lógico. Migración **aditiva**.

```ts
learningTracks = pgTable("learning_tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),                     // 1–120
  kind: text("kind").notNull(),                       // CHECK: certification | course | book | practice
  status: text("status").notNull().default("active"), // CHECK: active | waiting | done
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
  url: text("url"),                                   // http/https ≤ 2000, opcional (enlace del curso)
  weeklyTargetMinutes: integer("weekly_target_minutes"), // 15–3000, opcional
  targetDate: date("target_date"),                    // opcional
  position: integer("position").notNull(),            // orden dentro de su estado
  finishedAt: timestamp("finished_at", { withTimezone: true }), // solo si status = 'done'
  createdAt, updatedAt,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

learningSteps = pgTable("learning_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  trackId: uuid("track_id").notNull().references(() => learningTracks.id, { onDelete: "restrict" }),
  title: text("title").notNull(),                     // 1–200
  position: integer("position").notNull(),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt, updatedAt,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

learningSessions = pgTable("learning_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  trackId: uuid("track_id").notNull().references(() => learningTracks.id, { onDelete: "restrict" }),
  source: text("source").notNull(),                   // CHECK: timer | manual
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }), // null = cronómetro corriendo
  minutes: integer("minutes"),                        // 1–600, presente si ended_at no es null
  createdAt, updatedAt,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
// ÚNICO PARCIAL: una sola sesión corriendo → ((true)) WHERE ended_at IS NULL AND deleted_at IS NULL
```

- **`CHECK`:** longitudes, `kind`/`status`/`source` permitidos, `finished_at` presente si y solo si `status = 'done'`, `minutes` presente si y solo si `ended_at` no es nulo, `ended_at ≥ started_at`, `url ~ '^https?://'`, `practice` sin pasos (en Zod: un `CHECK` no lee otra tabla).
- **Bloqueo:** `LEARNING_ADVISORY_SPACE = 8000`. Poner en curso, crear en curso o reabrir toma `(8000, hashtext('learning:active'))` como **primer** lock; reordenar pasos toma `(8000, hashtext(track_id))`.
- **Exportación:** las tres tablas entran a `EXPORTABLE_TABLES` y al respaldo. Prettier sobre el snapshot de Drizzle tras `pnpm db:generate`.
- **FK a `projects`:** como en `goals`, `learning/db/schema.ts` importa la tabla de proyectos con la excepción de un archivo en ESLint. Un proyecto no se borra físicamente; si se archiva, el frente conserva el enlace.

## Contratos

- **`learning` → `projects`:** `registerProgressSource` (en `src/lib/progress-sources.ts`): por proyecto, `total` = frentes no borrados enlazados y `done` = suma de la fracción de cada uno (pasos vivos hechos / pasos vivos; 1 si está terminado). No contribuye a hitos.
  - **Cambio de contrato en `projects` (L3):** hoy `ProgressCounts` trunca `done` a entero (`clean` en `progress.ts`). Pasa a aceptar `done` fraccionario (0 ≤ `done` ≤ `total`, `total` entero); el porcentaje usa el valor exacto y los textos «N de M» muestran `done` redondeado hacia abajo. Pruebas: 1 tarea hecha de 2 más un frente al 50 % = 1,5 de 3 → 50 %, «1 de 3». Es el único cambio fuera de `learning` y sus contratos.
- **`weekly-review` → `learning`:** `getLearningWeekReview(weekStart)` devuelve `{ minutes }` de las sesiones terminadas cuyo inicio cae en esa semana de Lima. `logros.ts` lo suma al modelo (`studyMinutes`) y a la condición de «tranquila»; el copy formatea «3 h 20» y no muestra la cifra si es 0.
- **`today` → `learning`:** `getLearningTodaySummary(now)` devuelve los frentes en curso (título, siguiente paso, avance, minutos de la semana, meta, sesión corriendo). `today` dibuja la sección «Estudio» y usa las acciones de `learning` (`startSession`, `stopSession`, `completeStep`) como hoy usa las de `habits` y `tasks`.
- **Nadie más importa `learning`:** regla de ESLint nueva (como `goals` y `household`), con las excepciones de `today` y `weekly-review`.

## Comandos y estructura

Los mismos de `SPEC-core`; sin variables de entorno ni servicios externos.

```
src/modules/learning/ → module.ts, routes.ts, lock-keys.ts, db/schema.ts, contracts.ts,
                        tracks-*.ts, steps-*.ts, sessions-*.ts (Zod, dominio puro, acciones, queries, copy),
                        pace.ts (puro: semana, meta, ritmo a la fecha), revalidate.ts, export.ts, components/
src/app/(app)/learning/page.tsx, src/app/(app)/learning/[id]/page.tsx
src/modules/today/ → sección «Estudio» (componente y conteo en today-board.ts)
src/modules/weekly-review/ → cifra «Estudio» en logros.ts y review-copy.ts
src/modules/projects/progress.ts → `done` fraccionario (único cambio de contrato)
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | Pegar temario (líneas vacías, espacios, 500 pasos, NUL rechazado), siguiente paso y avance, semana de Lima (lunes 00:00, domingo 23:59, sesión que empieza el domingo y termina el lunes), meta semanal y textos, ritmo a la fecha (fecha hoy, pasada, sin temario), duración del cronómetro y umbral de 4 h, copy (**ninguna cadena prohibida**), `done` fraccionario en `combineProgressCounts` y su texto «N de M», cifra «Estudio» y «semana tranquila» en `logros.ts`, componentes de lista, detalle, hoja y tarjeta de Hoy |
| Integración | `CHECK` con inserts crudos, el límite de 2 en curso con dos solicitudes a la vez (control positivo: con 1 en curso, una sí entra), una sola sesión corriendo (dos «Estudiar» a la vez → una fila), «Deshacer» exacto de paso, sesión y estado, fuente de avance de `projects` (frente al 50 %, terminado, sin temario, borrado), minutos de la semana para la revisión, autorización de cada acción, exportación |
| E2E | **Un solo spec nuevo** (`learning.spec.ts`): crear un frente pegando el temario, marcar un paso y ver el siguiente, «Estudiar» y «Detener» (con reloj fijo), anotar tiempo a mano, el límite de 2, la tarjeta de Hoy; axe en 0 en ambos temas y 320 px (con `afterSaveSettled`); una captura con `expectScreenshot`. Entrada en `SPEC_MODULES` con `["learning", "today", "projects"]`. |

Local: solo el gate liviano; integración nueva de a un archivo (`rtk proxy pnpm test:integration <archivo>`). Lecciones aplicables: una entrada de navegación nueva cambia `e2e/home.spec.ts` y todas las capturas con la barra (dispatch de `update-screenshots.yml` tras el push); raíces de composición mockeadas en pruebas de página; `ON DELETE RESTRICT` = `23001`; tiempos con reloj de prueba decididos antes de escribir la función.

## Límites

- **Siempre:** las de `SPEC-core` y las lecciones de `CLAUDE.md`: `ownerAction(schema, handler)` y `requireOwner()`, locks de dos claves como primer lock, nada se borra físicamente, «Deshacer» exacto con el id que se creó o cambió, foco restaurado y `aria-disabled`, temporizadores limpiados (el cronómetro de la tarjeta incluido), logs con `describeError`, listas de ids validadas como conjuntos.
- **Preguntar primero:** dependencias nuevas, cambios en `ci.yml` o en la configuración de build, tocar `projects`, `goals` o `habits` más allá de sus contratos, un aviso nuevo en `reminders`, escribir en producción fuera de migraciones aditivas.
- **Nunca:** texto de culpa o «atrasado»; que otro módulo distinto de `today` importe `learning`; leer o seguir el enlace del curso desde el servidor; secretos o datos reales en el repo; PNG hechos en macOS; correr build, integración completa o E2E locales.

## Criterios de éxito

1. **Temario:** pegar 40 líneas crea 40 pasos en orden; «Hecho» avanza el siguiente paso y la barra; «Deshacer» lo revierte exacto.
2. **Límite:** nunca hay más de 2 frentes en curso, ni con dos solicitudes a la vez; la interfaz ofrece pasar uno a «En espera».
3. **Tiempo:** el cronómetro sigue corriendo tras recargar o cerrar la app y hay uno solo; «Detener» guarda los minutos; la sesión manual entra en la semana del día elegido.
4. **Ritmo:** la meta semanal y el ritmo a la fecha se calculan con la semana de Lima y nunca muestran culpa.
5. **Hoy, proyectos y revisión:** la tarjeta «Sigue con» aparece por cada frente en curso y desaparece sin ellos; un paso marcado sube el avance del proyecto enlazado y el frente pesa como una tarea; «Logros» muestra las horas de estudio de la semana y no las muestra en una semana sin sesiones.
6. **Calidad:** CI en verde; axe en 0 en ambos temas; movimiento reducido respetado; 320 px sin scroll horizontal; las tres tablas en `pnpm db:export` y el respaldo; HANDOFF, `todo` y mapa actualizados tras cada merge.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec. Un implementador a la vez (gate liviano). Un solo E2E nuevo (L3).

- **L1 — Frentes y temario:** migración de `learning_tracks` y `learning_steps`, manifiesto y entrada «Aprendizaje», lista con «En curso / En espera / Terminados», hoja «Nuevo frente» con temario pegado, detalle con temario (marcar, añadir, renombrar, reordenar, quitar), el límite de 2, regla de ESLint. Sin E2E.
- **L2 — Tiempo:** migración de `learning_sessions`, cronómetro y sesión manual, meta semanal, ritmo a la fecha, lista de sesiones en el detalle. Sin E2E.
- **L3 — Hoy, proyectos, revisión y E2E:** sección «Estudio» en `today`, fuente de avance en `projects` (con `done` fraccionario), cifra «Estudio» en la revisión semanal, el único E2E (`learning.spec.ts`).
- **L4 — Cierre:** retrospectiva, backlog, mapa y HANDOFF; Checkpoint en producción (Chrome del owner, datos `[QA]`) y **carga de los frentes reales con el owner**, como en «Mi hogar».

## Decisiones del owner (2026-10-29)

1. **Peso en el proyecto:** cada frente aporta su porcentaje y pesa como una tarea (opción c).
2. **Cronómetro olvidado:** el umbral de 4 h está bien.
3. **Revisión semanal:** las horas de estudio entran ya en v1.

Siguen como decisiones autónomas para revisar con el owner: el nombre «Aprendizaje», el temario plano sin secciones, que marcar un paso y registrar tiempo sean independientes, y que iniciar otro frente detenga el cronómetro que estaba corriendo.
