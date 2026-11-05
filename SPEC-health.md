# Spec: health

> Módulo `health` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` y, por contratos, de `habits`, `today` y `weekly-review` · Estado: **APROBADA v1.0 · cerrada el 2026-11-05** (E1–E5 en producción; aprobada el 2026-11-04: el owner aceptó todas las recomendaciones de la tanda de preguntas del mismo día y pidió construir el módulo completo en modo autónomo).

## Objetivo

Que entrenar en el gimnasio tenga registro: **saber qué rutina toca, qué hice la vez pasada para superarlo, apuntar cada serie con una mano y ver los récords crecer**. Hoy el owner no registra el gimnasio en ninguna app (2026-11-04); la app de salud que desarrolla aparte se orienta a la rehabilitación, no al ejercicio, así que el entrenamiento vive aquí. Se evaluó openGym como base y se descartó: es una app completa (no una librería), su código y sus textos son AGPL y sus imágenes son de Gym visual con licencia propia; se toma solo como inspiración (decisión del owner, 2026-11-04).

- **Catálogo de ejercicios** propio, corto y en español: una semilla de 64 ejercicios comunes escritos para la app (free-exercise-db, dominio público, solo como referencia) y los que el owner cree.
- **Rutinas** (plantillas): una lista ordenada de ejercicios con series objetivo («4 × 8–10») y descanso. Sin programas por semanas ni días asignados (eso lo hace el hábito).
- **Sesión:** se empieza desde una rutina o en blanco; cada serie viene con lo de la vez pasada y **un toque la marca hecha**; descanso automático; «Terminar».
- **Récords** por ejercicio (peso máximo, 1RM estimado, más repeticiones, más tiempo, más distancia), calculados al leer; «2 récords nuevos» al terminar.
- **Hábito enlazado:** un ajuste «Al terminar una sesión, marcar el hábito ___».
- **Hoy:** tarjeta «Entreno en curso» o «Empezar Rutina B» cuando el hábito toca hoy. **Revisión semanal:** «Entreno: 3 sesiones · 2 récords» en «Logros».

Fuera de este módulo (backlog): peso corporal y medidas, metas por ejercicio (fuente nueva en `goals`), mapa de músculos (MuscleMap, MIT), imágenes o GIFs (Gym visual, licencia por archivo; nunca en git), instrucciones paso a paso, RPE/RIR, drop sets y superseries, aviso del descanso con la pantalla bloqueada (push), registrar por Telegram, registrar una sesión pasada desde cero, sugerencias de progresión, sueño y alimentación, importación (se empieza de cero).

### Supuestos (aprobados con la tanda del 2026-11-04)

1. **Para usar en el gimnasio con una mano:** teclas grandes, un toque por serie, teclado numérico; en escritorio se arman rutinas y se mira el historial.
2. **Cada serie se guarda al tocarla** (cola optimista de siempre); si falla la señal: «Sin guardar» y reintento, nunca se pierde en silencio. La sesión abierta sobrevive a cerrar la app o recargar. Sin modo sin conexión completo.
3. **Kilos con pasos de 0,25**, guardados tal como se escriben (en gramos enteros). En mancuernas, lo que marca una (el ejercicio dice «por mancuerna»).
4. **Una sola sesión abierta a la vez** (lock + índice único parcial, como el cronómetro de Aprendizaje).
5. **Nada se borra físicamente:** `deleted_at` con «Deshacer». Todo entra en `pnpm db:export` y el respaldo.
6. **Sin dependencias nuevas, sin imágenes, un solo E2E**, y el tono de siempre (nada de «solo», «todavía» ni contadores de lo que faltó).

### Historias de usuario

1. En `/health` creo «Rutina A»: busco «sentadilla» en el catálogo, la agrego con «4 × 6–8» y 2 min de descanso, luego «Press de banca con barra» con «4 × 8–10».
2. Llego al gimnasio: en Hoy veo «Empezar Rutina A» (el hábito «Gimnasio» toca hoy). La toco y se abre la sesión con «Sentadilla con barra: la vez pasada 80 kg × 8».
3. Hago la serie y toco su casilla: queda hecha y arranca «Descanso 2:00» con +15 s, −15 s y «Saltar». Al llegar a cero, vibra y lo anuncia.
4. En la tercera serie subo a 82,5 kg y hago 7: corrijo el peso y las repeticiones antes de tocar la casilla.
5. Toco «Terminar»: «52 min · 14 series · 2 récords nuevos: Sentadilla con barra 82,5 kg; Press de banca 1RM estimado 79 kg», con la celebración; el hábito «Gimnasio» queda marcado hoy.
6. En «Sentadilla con barra» veo sus récords, una línea con el mejor peso de cada sesión y el historial por fecha.
7. El domingo, la revisión semanal dice «Entreno: 3 sesiones · 2 récords».

## Decisiones

| Tema | Decisión | Origen |
|---|---|---|
| Nombre y lugar | «Entreno», ruta `/health`, ícono `Dumbbell`; barra lateral después de Notas (`navOrder` 70), bajo «Más» en el celular; sin atajo de número (1–8 ocupados). El id `health` queda para cuando entren sueño o alimentación. | Owner (recomendación aceptada) |
| Tipos de ejercicio | `weight_reps` (peso × repeticiones), `reps` (repeticiones, lastre opcional), `time` (segundos), `cardio` (tiempo y distancia opcional). | Owner |
| Catálogo | Semilla de 64 ejercicios (anexo) con `seed_key` estable, insertada por la migración con ids derivados (`md5`), idempotente. Cada ejercicio: nombre (1–80, único entre los vivos sin mayúsculas ni acentos), tipo, grupo muscular, equipo, «por mancuerna» y descanso por defecto (30–600 s, 90 por defecto). Los de la semilla se pueden renombrar, editar y borrar como cualquiera. «Nuevo ejercicio» desde el catálogo y desde el buscador de la sesión o la rutina. | Owner (semilla propia en español) |
| Grupos y equipo | Grupos: pecho, espalda, hombros, bíceps, tríceps, antebrazo, abdomen, cuádriceps, isquiotibiales, glúteos, pantorrillas, cuerpo completo, cardio. Equipo: barra, mancuernas, máquina, polea, peso corporal, kettlebell, banda, otro. Ids en inglés, etiquetas en el copy. | Autónoma |
| Rutinas | Nombre (1–60), orden manual de las rutinas y de sus ejercicios (teclado y arrastre). Cada ejercicio de la rutina: series objetivo (1–10), repeticiones mín–máx (1–100; iguales = un número) o segundos objetivo según el tipo, descanso propio opcional (si no, el del ejercicio). Un ejercicio puede repetirse en una rutina. Hasta 30 ejercicios por rutina. | Owner |
| Rotación | «La que toca» = la rutina viva cuya última sesión terminada es la más antigua (las nunca hechas primero, por orden). Sin calendario. | Owner (A/B/C sin días) |
| Empezar | Desde una rutina (copia sus ejercicios y crea sus series planificadas) o «Sesión libre». Con una sesión abierta, empezar otra se rechaza con «Ya tienes un entreno en curso» y «Seguir». Lock `(10000, hashtext('health:session'))` como primer lock + índice único parcial `WHERE ended_at IS NULL AND deleted_at IS NULL`. | Owner |
| Precarga | Cada serie planificada trae los valores de la **última serie hecha (no de calentamiento) en la misma posición** de ese ejercicio en la sesión terminada más reciente; si no hay, la última serie hecha de ese ejercicio; si nunca se hizo, vacía. La línea «La vez pasada: 80 kg × 8 · 80 × 8 · 80 × 7» se ve sobre las series. Al marcar una serie hecha (no de calentamiento), las series siguientes del mismo ejercicio que siguen planificadas, no son de calentamiento y están **vacías** toman sus valores (E5, aprobado por el owner el 2026-11-05); una serie con algo escrito o precargado no cambia, y desmarcar no borra lo copiado. | Owner |
| Serie | Peso (0–1000 kg, pasos de 0,25; guardado en gramos), repeticiones (1–999), segundos (1–36 000), distancia (0–1 000 km, guardada en metros) según el tipo. Una casilla «hecha» (`done_at`), y «Calentamiento» como marca de la serie (no cuenta para récords ni volumen). Añadir serie (copia la anterior), quitar serie con «Deshacer». Marcar exige los valores obligatorios del tipo y copia sus valores a las series siguientes vacías (ver «Precarga»): nunca la marca de calentamiento ni el estado «hecha». | Owner |
| Durante la sesión | Añadir ejercicio (buscador del catálogo), quitarlo con «Deshacer», reordenar; nota de la sesión (≤ 500). Lo que se cambia en la sesión **no toca la rutina**. | Owner |
| Descanso | Al marcar una serie arranca la cuenta regresiva con el descanso del ejercicio en la rutina (o del ejercicio): barra fija abajo con el tiempo, +15 s, −15 s y «Saltar». Al llegar a 0: `navigator.vibrate` donde exista y aviso en el anunciador (`useAnnouncer`). Vive en el cliente (fin guardado como instante, sobrevive a recargar en `sessionStorage`, con try/catch); sin push. | Owner (pantalla bloqueada: backlog) |
| Terminar | «Terminar» abre una hoja con duración, series hechas y nota. Las series planificadas sin marcar se quitan (lógico). Sin ninguna serie hecha, la hoja ofrece «Descartar la sesión» en vez de terminarla. Si pasaron más de 4 h desde el inicio, la hoja propone como fin la hora de la última serie marcada + 5 min, editable. «Deshacer» de «Terminar» reabre la sesión y devuelve las series quitadas, solo si nadie la tocó después. | Owner (4 h, como Aprendizaje) |
| Sesiones pasadas | El detalle de una sesión terminada permite corregir series, la nota y las horas, y borrarla con «Deshacer». Los récords se recalculan solos (se derivan). | Autónoma |
| Récords | Se calculan al leer, nunca se guardan. Por ejercicio y tipo, sobre series hechas y no de calentamiento de sesiones terminadas y vivas: `weight_reps` → peso máximo y 1RM estimado (Epley, `peso × (1 + reps/30)`, solo con 1–12 repeticiones; con 1 repetición es el peso); `reps` → más repeticiones en una serie; `time` → más segundos; `cardio` → más distancia y más tiempo. Un récord es **nuevo** en una sesión si supera (estrictamente) todo lo anterior a su inicio; el primer registro de un ejercicio no es récord. | Owner |
| Al terminar | Resumen «52 min · 14 series · 2 récords nuevos» con la lista; con récords, `celebrate()` (respeta movimiento reducido). Sin récords, el resumen sin celebración. | Owner |
| Detalle del ejercicio | `/health/exercises/[id]`: datos editables, récords con su fecha, línea SVG simple del mejor peso (o reps/tiempo/distancia según el tipo) por sesión de los últimos 12 meses con una tabla accesible equivalente, historial por sesión de 20 en 20. Componente propio pequeño (sin mover el gráfico de `finance`). | Owner; autónoma (componente propio) |
| Hábito enlazado | Ajuste único en `/health` → «Ajustes»: «Al terminar una sesión, marcar el hábito ___» (hábitos vivos y no archivados, de medida `check` y tipo `build`; o ninguno). Al terminar, marca el **día de Lima del fin** con un contrato nuevo de `habits`, en la misma transacción. Si el hábito ya estaba hecho ese día, nada cambia. La sesión guarda si fue ella la que lo marcó (el día, el hábito y la marca de tiempo del registro al marcarlo): «Deshacer» de «Terminar» desmarca ese hábito ese día solo en ese caso, si sigue hecho y si nadie tocó el registro desde entonces (aunque «Ajustes» haya cambiado); borrar una sesión después **no** lo desmarca. Un hábito borrado o archivado deja el ajuste en «(ya no existe)» y no marca nada. | Owner |
| Hoy | Slot «Entreno» después de «Estudio». Con una sesión abierta: «Entreno en curso · Rutina A · 23 min» y «Seguir». Sin sesión, si el hábito enlazado toca hoy y no está hecho: «Empezar Rutina B» (la que toca) y «Otra rutina». Si no, la sección no sale. Nunca bloquea «Día completo». | Owner |
| Revisión semanal | «Logros» suma «Entreno: 3 sesiones · 2 récords» (sesiones terminadas cuyo inicio cae en la semana de Lima; récords nuevos en esas sesiones; «· 2 récords» solo si hay) y cuenta para «Una semana tranquila». Sin cifra si es 0. | Owner |
| Tono | Lista prohibida de `learning` más «solo», «todavía», «perdiste», «fallaste»; una prueba recorre el copy (`tests/modules/health-copy.test.ts`). | Principios UX 6 |

## Pantallas

- **`/health`:** arriba, la sesión abierta («Seguir») o «Empezar» con la rutina que toca y «Otra rutina» / «Sesión libre». Debajo, «Rutinas» (orden manual; fila con nombre, n.º de ejercicios y «Hace 3 días»; «Nueva rutina»), «Últimas sesiones» (10; fila con fecha, rutina, duración, series y récords; «Ver todas») y enlaces a «Ejercicios» y «Ajustes». Vacío: «Arma tu primera rutina» con «Nueva rutina» y «Sesión libre».
- **`/health/routines/[id]`:** nombre en el sitio, ejercicios en orden con series objetivo y descanso editables, «Agregar ejercicio», reordenar, quitar, «Empezar esta rutina», «Eliminar» con «Deshacer».
- **`/health/sessions/[id]`:** la sesión (abierta o terminada). Cabecera con rutina, hora de inicio y tiempo corriendo; un bloque por ejercicio con «La vez pasada», sus series (peso, reps, casilla) y «Añadir serie»; «Agregar ejercicio»; barra de descanso fija abajo; «Terminar». Terminada: resumen, récords nuevos y edición.
- **`/health/sessions`:** todas las sesiones, de 30 en 30.
- **`/health/exercises`:** catálogo con buscador (sin acentos ni mayúsculas) y filtro por grupo; «Nuevo ejercicio». **`/health/exercises/[id]`:** detalle (ver Decisiones).
- **Hoja «Ajustes»:** hábito enlazado.

Principios aplicables (`docs/principios-ux.md`): registro en un toque (la casilla de la serie), progreso visible (récords), sin castigo, UI optimista, foco restaurado y `aria-disabled` con guarda, toasts que no tapan el control enfocado (la barra de descanso suma su altura a `--toast-offset`), 320 px sin scroll horizontal, objetivos táctiles ≥ 44 px.

## Modelo de datos

Ocho tablas en tres migraciones aditivas (`0029` en E1, `0030` en E2, `0031` en E4: las dos columnas de la marca del hábito), todas con borrado lógico salvo los ajustes.

```ts
healthExercises = pgTable("health_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  seedKey: text("seed_key"),                        // único si no es nulo; solo la semilla
  name: text("name").notNull(),                      // 1–80
  nameKey: text("name_key").notNull(),               // minúsculas sin acentos, calculada por la app (búsqueda y unicidad)
  kind: text("kind").notNull(),                      // CHECK: weight_reps | reps | time | cardio
  muscleGroup: text("muscle_group").notNull(),       // CHECK: los 13 grupos
  equipment: text("equipment").notNull(),            // CHECK: los 8 equipos
  perDumbbell: boolean("per_dumbbell").notNull().default(false),
  restSeconds: integer("rest_seconds").notNull().default(90), // 30–600
  createdAt, updatedAt, deletedAt,
});
// ÚNICO PARCIAL: (name_key) WHERE deleted_at IS NULL (unaccent no es IMMUTABLE: la clave la arma la app con NFD)

healthRoutines = pgTable("health_routines", {
  id, name /* 1–60 */, position: integer("position").notNull(), createdAt, updatedAt, deletedAt,
});

healthRoutineExercises = pgTable("health_routine_exercises", {
  id, routineId /* FK restrict */, exerciseId /* FK restrict */, position,
  targetSets: integer("target_sets").notNull(),      // 1–10
  repsMin: integer("reps_min"), repsMax: integer("reps_max"), // 1–100, min ≤ max; solo weight_reps/reps
  targetSeconds: integer("target_seconds"),          // 1–36 000; solo time/cardio
  restSeconds: integer("rest_seconds"),              // 30–600, opcional
  createdAt, updatedAt, deletedAt,
});

healthSettings = pgTable("health_settings", {
  id: integer("id").primaryKey(),                    // CHECK id = 1 (una fila)
  habitId: uuid("habit_id").references(() => habits.id, { onDelete: "restrict" }),
  updatedAt,
});

// E2
healthSessions = pgTable("health_sessions", {
  id, routineId /* FK restrict, opcional */,
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }), // null = abierta
  note: text("note"),                                // ≤ 500
  habitMarkedDay: date("habit_marked_day"),          // el día que esta sesión marcó el hábito
  habitMarkedId: uuid("habit_marked_id"),            // E4 (0031): qué hábito marcó (FK restrict)
  habitMarkAt: timestamp("habit_mark_at", { withTimezone: true }), // E4: updated_at del registro al marcarlo (ms)
  // CHECK: los tres juntos o ninguno
  createdAt, updatedAt, deletedAt,
});
// ÚNICO PARCIAL: ((true)) WHERE ended_at IS NULL AND deleted_at IS NULL

healthSessionExercises = pgTable("health_session_exercises", {
  id, sessionId /* FK restrict */, exerciseId /* FK restrict */, position,
  restSeconds: integer("rest_seconds"),              // copiado de la rutina al empezar
  createdAt, updatedAt, deletedAt,
});

healthSets = pgTable("health_sets", {
  id, sessionExerciseId /* FK restrict */, position,
  weightGrams: integer("weight_grams"),              // 0–1 000 000, múltiplo de 250
  reps: integer("reps"),                             // 1–999
  seconds: integer("seconds"),                       // 1–36 000
  distanceMeters: integer("distance_meters"),        // 0–1 000 000
  warmup: boolean("warmup").notNull().default(false),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt, updatedAt, deletedAt,
});
```

- **`CHECK`:** longitudes y rangos de arriba, enums, `ended_at ≥ started_at`, `reps_min ≤ reps_max`. Qué campos exige una serie hecha según el tipo de su ejercicio vive en Zod (un `CHECK` no lee otra tabla).
- **Bloqueo:** `HEALTH_ADVISORY_SPACE = 10000` (el siguiente libre; 5000 y 6000 ya están compartidos). Toda escritura de sesión toma `(10000, hashtext('health:session'))` como primer lock; el orden de rutinas `(10000, hashtext('health:routines'))`; el orden dentro de una rutina o sesión `(10000, hashtext(<id>))`.
- **FK a `habits`:** como `goals`, `health/db/schema.ts` importa la tabla de hábitos con la excepción de un archivo en ESLint.
- **Exportación:** las ocho tablas en `EXPORTABLE_TABLES` (`health/export.ts`). Prettier sobre el snapshot tras `pnpm db:generate`.

## Contratos

- **`health` → `habits` (nuevo, E4):** `habits/contracts.ts` exporta `getCheckHabitOptions()` (hábitos vivos, no archivados, `check` y `build`) y `markHabitDoneBySource(tx, habitId, day)` → `"marked" | "already" | "unavailable"`, con las reglas de `setHabitDoneById` (ventana de días, archivado, medida) y `unmarkHabitBySource(tx, habitId, day)` para el «Deshacer». Es el único cambio fuera de `health` además de `today` y `weekly-review`; `habits` no importa `health`.
- **`today` → `health`:** `getHealthTodaySummary(now)` → `{ running: { id, routineName, startedAt } | null, next: { routineId, routineName } | null, habitDue: boolean }`. `today` dibuja el slot «Entreno» (componente de `health`) y lo enlaza.
- **`weekly-review` → `health`:** `getHealthWeekReview(weekStart)` → `{ sessions, records }`. `logros.ts` lo suma (`trainingSessions`, `trainingRecords`) y a la condición de «tranquila».
- **Nadie más importa `health`:** regla de ESLint nueva (`HEALTH_ONLY_CONTRACTS`), con las excepciones de `today` y `weekly-review`.
- **Reloj compartido:** el `useSecondClock` de `learning` pasa a `src/lib/use-second-clock.ts` (un solo intervalo para los dos cronómetros); `learning` lo importa desde ahí. Cambio mecánico.

## Comandos y estructura

Los mismos de `SPEC-core`; sin variables de entorno ni servicios externos.

```
src/modules/health/ → module.ts, routes.ts, lock-keys.ts, db/schema.ts, seed.ts (semilla, también la usa la migración),
                      exercises-*.ts, routines-*.ts, sessions-*.ts, sets-*.ts (Zod, dominio, acciones, consultas, copy),
                      records.ts (puro: récords y «nuevos»), rotation.ts (puro), weight.ts (texto ↔ gramos),
                      contracts.ts, export.ts, revalidate.ts, components/
src/app/(app)/health/ → page.tsx, routines/[id], sessions/page.tsx, sessions/[id], exercises/page.tsx, exercises/[id]
src/modules/habits/contracts.ts → getCheckHabitOptions, markHabitDoneBySource, unmarkHabitBySource (E4)
src/modules/today/ → slot «Entreno»; src/modules/weekly-review/ → cifra «Entreno»
src/lib/use-second-clock.ts → reloj compartido (sale de learning)
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | Peso texto ↔ gramos («82,5», «82.5», «0,3» rechazado, 1000 kg), precarga (misma posición, sin historia, calentamientos fuera), récords (Epley con 1, 12 y 13 reps, empates no cuentan, primer registro no es récord, calentamiento fuera, sesión borrada fuera, por tipo), rotación (nunca hechas primero, empates por orden), umbral de 4 h y fin propuesto, descanso (±15 s, cero, recarga con `sessionStorage` que lanza), copy (**ninguna cadena prohibida**, con control positivo), componentes (serie, bloque de ejercicio, barra de descanso, resumen, slot de Hoy, cifra de «Logros») |
| Integración | `CHECK` con inserts crudos; semilla idempotente (correr la migración dos veces = 64); nombre único sin acentos; una sola sesión abierta con dos «Empezar» a la vez (control positivo: tras terminar, otra entra); «Terminar» quita las planificadas y su «Deshacer» exacto; hábito enlazado (marca, «ya estaba», archivado, «Deshacer» que desmarca solo lo propio, borrar la sesión no desmarca); récords sobre la base; contratos de Hoy y revisión; autorización de cada acción; exportación |
| E2E | **Un solo spec nuevo** (`health.spec.ts`, E4): crear una rutina con dos ejercicios, empezarla, marcar series (con la barra de descanso), terminar y ver el récord en la segunda sesión, el hábito marcado y la tarjeta de Hoy; axe en 0 en ambos temas y 320 px (`afterSaveSettled`); una captura con `expectScreenshot`. Extiende `boardTest` y limpia sus tablas antes y después (como `learning`). Entrada en `SPEC_MODULES` con `["health", "today", "habits"]` y `ROUTE_MODULES.health`. |

Local: solo el gate liviano; integración nueva de a un archivo (`rtk proxy pnpm test:integration <archivo>`), luego `pnpm db:test:stop` y borrar `.pgdata`. Lecciones aplicables: la entrada nueva de navegación cambia `e2e/home.spec.ts` y las capturas con la barra (dispatch de `update-screenshots.yml` tras el push de E1); raíces de composición mockeadas en pruebas de página; `ON DELETE RESTRICT` = `23001`; marcas de tiempo comparadas por un «Deshacer» truncadas al milisegundo; reloj de prueba decidido antes de escribir la función.

## Límites

- **Siempre:** las de `SPEC-core` y las lecciones de `CLAUDE.md`: `ownerAction(schema, handler)` y `requireOwner()`, locks de dos claves como primer lock, nada se borra físicamente, «Deshacer» exacto con el id que se cambió, foco restaurado y `aria-disabled`, temporizadores limpiados (el descanso y el reloj incluidos), logs con `describeError`, listas de ids validadas como conjuntos.
- **Preguntar primero:** dependencias nuevas, cambios en `ci.yml` o la configuración de build, tocar `habits`, `today` o `weekly-review` más allá de lo escrito en «Contratos», escribir en producción fuera de migraciones aditivas.
- **Nunca:** texto de culpa; copiar código, textos o imágenes de openGym o de Gym visual; que otro módulo distinto de `today` y `weekly-review` importe `health`; datos reales en el repo; PNG hechos en macOS; correr build, integración completa o E2E locales.

## Criterios de éxito

1. **Catálogo y rutinas:** los 64 ejercicios de la semilla están en producción tras la migración; crear una rutina con 5 ejercicios toma < 60 s en el celular.
2. **Sesión:** empezar una rutina crea sus series con lo de la vez pasada; una serie se marca en un toque y sobrevive a recargar; nunca hay dos sesiones abiertas, ni con dos solicitudes a la vez; «Terminar» y su «Deshacer» son exactos.
3. **Descanso:** arranca al marcar, responde a ±15 s y «Saltar», vibra (Android) y se anuncia al llegar a 0, y se limpia al desmontar.
4. **Récords:** el resumen de una sesión nombra exactamente los récords que superó; el detalle del ejercicio los muestra con su fecha y la línea.
5. **Hábito, Hoy y revisión:** terminar marca el hábito enlazado ese día y su «Deshacer» lo desmarca solo si lo marcó; la tarjeta de Hoy aparece con una sesión abierta o el hábito pendiente y desaparece si no; «Logros» muestra «Entreno» y no lo muestra en una semana sin sesiones.
6. **Calidad:** CI en verde; axe en 0 en ambos temas; movimiento reducido respetado; 320 px sin scroll horizontal; las ocho tablas en `pnpm db:export` y el respaldo; HANDOFF, `todo` y mapa actualizados tras cada merge.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md`. Un implementador a la vez (gate liviano). Un solo E2E nuevo (E4).

- **E1 — Catálogo y rutinas:** migración `0029` (ejercicios con la semilla, rutinas, ejercicios de rutina, ajustes), manifiesto «Entreno», `/health` con «Rutinas», catálogo con buscador y «Nuevo ejercicio», detalle básico del ejercicio, rutina con sus ejercicios, regla de ESLint, exportación. Sin E2E.
- **E2 — Sesión:** migración `0030` (sesiones, ejercicios de sesión, series), empezar (rutina o libre), precarga, marcar y editar series, añadir y quitar, descanso, terminar/descartar con «Deshacer» y el umbral de 4 h, `/health/sessions` y su detalle, el reloj a `src/lib`. Sin E2E.
- **E3 — Récords e historial:** `records.ts`, «récords nuevos» en el resumen con `celebrate`, detalle del ejercicio con récords, línea y historial, récords en «Últimas sesiones». Sin E2E.
- **E4 — Hábito, Hoy, revisión y E2E:** contrato nuevo en `habits`, «Ajustes», slot «Entreno» en Hoy, cifra en «Logros», el único E2E (`health.spec.ts`).
- **E5 — Cierre:** Checkpoint en producción (Chrome del owner, datos `[QA]`, borrados después), retrospectiva, backlog, mapa, HANDOFF y archivo; **carga de las rutinas reales con el owner**.

## Anexo: semilla del catálogo (64)

Escrita para la app (nombres comunes en español; ninguno copiado de openGym). Tipo `weight_reps` salvo que se indique; equipo entre paréntesis; ★ = por mancuerna.

- **Pecho (10):** Press de banca con barra (barra) · Press inclinado con barra (barra) · Press de banca con mancuernas ★ · Press inclinado con mancuernas ★ · Aperturas con mancuernas ★ · Cruce de poleas (polea) · Press de pecho en máquina (máquina) · Contractora de pecho (máquina) · Fondos en paralelas (peso corporal, `reps`) · Flexiones (peso corporal, `reps`).
- **Espalda (9):** Dominadas (peso corporal, `reps`) · Jalón al pecho (polea) · Remo con barra (barra) · Remo con mancuerna ★ · Remo en polea baja (polea) · Remo en máquina (máquina) · Peso muerto (barra) · Pullover en polea (polea) · Hiperextensiones (peso corporal, `reps`).
- **Hombros (7):** Press militar con barra (barra) · Press de hombros con mancuernas ★ · Elevaciones laterales ★ · Elevaciones frontales ★ · Pájaros ★ · Face pull (polea) · Encogimientos con mancuernas ★.
- **Bíceps (5):** Curl con barra (barra) · Curl con mancuernas ★ · Curl martillo ★ · Curl en polea (polea) · Curl predicador (máquina).
- **Tríceps (5):** Extensión de tríceps en polea (polea) · Press francés (barra) · Extensión sobre la cabeza con mancuerna (mancuernas) · Fondos en banco (peso corporal, `reps`) · Press de banca con agarre cerrado (barra).
- **Piernas (16):** Sentadilla con barra (barra; cuádriceps) · Sentadilla frontal (barra; cuádriceps) · Sentadilla goblet (mancuernas; cuádriceps) · Prensa de piernas (máquina; cuádriceps) · Extensión de cuádriceps (máquina; cuádriceps) · Zancadas con mancuernas ★ (cuádriceps) · Sentadilla búlgara ★ (cuádriceps) · Peso muerto rumano (barra; isquiotibiales) · Curl femoral tumbado (máquina; isquiotibiales) · Curl femoral sentado (máquina; isquiotibiales) · Hip thrust (barra; glúteos) · Patada de glúteo en polea (polea; glúteos) · Abductores en máquina (máquina; glúteos) · Aductores en máquina (máquina; cuádriceps) · Elevación de talones de pie (máquina; pantorrillas) · Elevación de talones sentado (máquina; pantorrillas).
- **Abdomen (6):** Plancha (peso corporal, `time`) · Plancha lateral (peso corporal, `time`) · Crunch (peso corporal, `reps`) · Elevación de piernas colgado (peso corporal, `reps`) · Rueda abdominal (otro, `reps`) · Crunch en polea (polea).
- **Cardio (6, `cardio`):** Cinta · Bicicleta estática · Elíptica · Remo ergómetro · Escaladora · Saltar la cuerda (todas «máquina» salvo la cuerda, «otro»). «Remo ergómetro» y no «Remo en máquina», que ya es el de espalda: dos ejercicios vivos no comparten nombre (E1).

## Decisiones autónomas para revisar con el owner

- Los grupos musculares y el equipo de la lista; los 64 ejercicios de la semilla.
- La precarga por posición de la serie y la línea «La vez pasada».
- Que las series sin marcar se quiten al terminar, y que una sesión sin series hechas solo se pueda descartar.
- Que el descanso venga del ejercicio en la rutina (o del ejercicio) y viva solo en el cliente.
- El fin propuesto tras 4 h (última serie + 5 min).
- Que las sesiones pasadas se puedan corregir y que borrar una no desmarque el hábito.
- Epley limitado a 1–12 repeticiones y que el primer registro de un ejercicio no sea récord.
- El componente de línea propio (sin mover el gráfico de `finance`) y mover `useSecondClock` a `src/lib`.
