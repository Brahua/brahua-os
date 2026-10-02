# Spec: habits

> Módulo `habits` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` · Estado: **APROBADO v2** (2026-10-02; el owner aceptó también las decisiones marcadas para revisar).

## Objetivo

Que mantener un hábito cueste un toque y que el progreso real se vea, sin culpa:

- **Registrar con un toque** desde el celular, en menos de 2 segundos, con "Deshacer".
- Cada hábito se mide como **sí/no** o como **cantidad** con meta y unidad (8 vasos, 30 min, 2 veces).
- **Frecuencias** reales: diaria, X veces por semana o días fijos de la semana.
- **Hábitos a evitar** ("no fumar"): se registra solo la recaída y se cuentan los días limpios.
- **Rachas con compasión** (principio 6 de `docs/principios-ux.md`): pausas por viaje o enfermedad, registro hasta 7 días atrás, cumplimiento semanal y nunca rojo por un día fallado.

Lo que aprendimos de Notion (ver `CAPABILITY-MAP.md`): los hábitos eran columnas con un checkbox y se abandonaron. Aquí son **filas con registros por día**, de donde salen rachas, cuotas semanales ("4 de 6") y el historial.

Fuera de este módulo: avisos y horarios (mañana/noche) de cada repetición (`reminders`), tablero diario combinado (`today`, que consume el contrato de aquí), metas enlazadas (`goals`) y la revisión semanal (`weekly-review`). **Sin importación desde Notion** (decisión del owner, 2026-10-02). Esta spec reemplaza lo que dice la fila `habits` del mapa ("diaria o X veces por semana", "importación del Habit tracker"); el mapa se ajusta al aprobarla.

### Historias de usuario

1. Abro Hábitos en el celular y toco "Meditar": queda hecho, veo la racha subir y puedo deshacer.
2. "Agua, 8 vasos al día": cada toque suma un vaso; al llegar a 8 queda cumplido.
3. "Medicación, 2 veces al día": toco en la mañana (1/2) y en la noche (2/2).
4. "Gimnasio, 3 veces por semana": cualquier día cuenta; veo "2 de 3 esta semana".
5. "Inglés, lunes, miércoles y viernes": solo esos días aparece en "Hoy"; los otros no rompen la racha.
6. Me voy de viaje del 10 al 20: pauso "Gimnasio" y la racha no se rompe.
7. Ayer olvidé marcar "Leer": lo registro hoy (hasta 7 días atrás).
8. Veo la semana de todos mis hábitos ("18 de 24 esta semana") y el mes de cada uno en un calendario.
9. "No fumar": el pad dice "12 DÍAS LIMPIO"; si recaigo, lo registro con un toque (con "Deshacer") y la cuenta vuelve a empezar, sin culpa.

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Medición | `check` (sí/no: un toque marca el día) o `quantity` (meta entera 1–10 000, unidad 1–20 caracteres y **paso** 1–meta, por defecto 1). En `quantity` cada toque suma el paso y el día se cumple cuando la cantidad llega a la meta (se puede pasar: 10/8 vasos). | Decisión del owner. |
| Tipo | `build` (a cumplir, el de siempre) o `avoid` (a evitar). En `avoid` el toque registra una **recaída** del día: el día se cumple si **no** hay recaída. v1: `avoid` es solo sí/no y diario (un límite como "máximo 2 cafés" queda fuera). | Decisión del owner (evitar en v1). Restringirlo a sí/no diario: **decisión para revisar con el owner**. |
| Varias veces al día | No es un tipo aparte: es un hábito **diario** de cantidad con unidad "veces", meta N y paso 1. El formulario ofrece el atajo "Varias veces al día" que lo rellena. Las franjas (mañana/noche) y sus avisos son de `reminders`. | Decisión del owner. Una sola regla de cumplimiento. |
| Frecuencia | `daily`; `weekly_count` (X de 1–6 veces por semana, cualquier día); `weekdays` (1–6 días fijos ISO 1–7). Siete por semana o los 7 días es "Diaria". | Decisión del owner. |
| Semana y día | Semana de **lunes a domingo**; el día es el de Lima (`America/Lima`, `ownerDateKey` de `src/lib/time.ts`), como en `tasks`. | Decisión del owner. |
| Fecha de inicio | `start_date` (por defecto hoy, hasta 7 días atrás). Antes de ella no hay días programados ni registros. | Un hábito nuevo no empieza con días "sin cumplir". |
| Registro atrás | Hoy y los **7 días anteriores** (Lima): marcar, desmarcar y corregir la cantidad de un día. Más atrás es solo lectura. Nunca días futuros. | Decisión del owner. |
| Toque en sí/no | El pad es un interruptor (`aria-pressed`): tocar uno hecho lo desmarca. Ambos con "Deshacer" en el aviso. | **Decisión para revisar con el owner.** Desmarcar sin ir al detalle; es lo que el patrón `HabitPad` del DS ya hace. |
| Toque en cantidad | Suma el paso; "Deshacer" lo resta. Para poner otro valor (o restar sin el aviso), "Ajustar" abre una hoja con la cantidad del día (campo numérico y −/+). | **Decisión para revisar con el owner.** Un toque para el caso común; el valor exacto a un paso más. |
| Cantidades | Enteras (0–99 999 por día). Sin decimales: la unidad se elige para que no hagan falta (min, páginas, vasos). | **Decisión para revisar con el owner.** Evita `numeric` y redondeos. |
| Meta en el historial | Cada registro guarda la meta vigente ese día (`target`). Cambiar la meta actualiza el registro de hoy en adelante; los días pasados conservan la suya. | **Decisión para revisar con el owner.** Subir la meta no "rompe" días ya cumplidos (principio 6). |
| Cambiar frecuencia o medición | La frecuencia se puede cambiar siempre y la racha se recalcula con la regla nueva sobre todo el historial. La medición (`check`/`quantity`) **no** cambia si ya hay registros: se archiva y se crea otro. | **Decisión para revisar con el owner.** Versionar reglas es mucha complejidad para un solo usuario. |
| Pausas | Rango de fechas (inicio y fin, ambos incluidos, máximo 90 días) con motivo opcional ("Viaje"). Sin solapes por hábito. Pueden empezar hasta 7 días atrás o en el futuro (un viaje planeado). "Reanudar" termina la pausa ayer (o la elimina si empieza hoy o aún no empezó). Los días en pausa **no rompen ni suman** a la racha, aunque tengan registro. | Decisión del owner (pausa). Límites: **decisión para revisar con el owner** (90 días, misma ventana de 7 días hacia atrás). |
| Archivar | "Archivar" saca el hábito de "Hoy", "Semana" y `today`, y conserva todo; se reactiva desde "Archivados". Archivar no congela la racha (para eso está la pausa). | Mismo patrón que las áreas: terminar un hábito no es un error. |
| Eliminar | Borrado lógico (`deleted_at`) para lo creado por error, con confirmación en la página si tiene registros y "Deshacer" en el aviso. Sus registros y pausas se ocultan con él y vuelven al restaurarlo. | Mismo principio que proyectos y tareas; nunca borrado físico. |
| Área | Opcional, solo áreas activas; se conserva si el área se archiva después. Colorea el LED del pad. | Como `tasks`. **Decisión para revisar con el owner** (en proyectos es obligatoria). |
| Orden | Manual: arrastrando (`@dnd-kit`) y con "Subir"/"Bajar", como las áreas. Un hábito nuevo va al final. | El owner decide qué ve primero; el orden por hora llega con `reminders`. |
| Identidad y momento | Opcionales: frase de identidad ("Soy alguien que lee", ≤ 120) y momento ("Después del desayuno", ≤ 60), como texto. La hora y el aviso son de `reminders`. | Principios 10 y 11, sin depender de `reminders`. |
| Hitos de racha | Al llegar a 7, 30, 90 y 365 (días o semanas), el aviso lo celebra con un texto distinto; confeti solo en 30 y más, y nunca con movimiento reducido. | Principio 15 (recompensa variable con moderación). |
| Copy | Nunca "fallaste", "perdiste" ni rojo. Un día sin cumplir se ve vacío; uno en pausa, con el guion de "descanso" del DS. | `docs/principios-ux.md`, "Lo que no haremos". |

## Rachas y cumplimiento

Definiciones (funciones puras en `streak.ts`, con `today` = día de Lima):

- **Día cumplido:** su registro tiene `quantity >= target` (en `check`, `target` = 1). En `avoid`, al revés: el día se cumple si **no** tiene recaída (`quantity = 0` o sin registro).
- **Día disponible:** desde `start_date`, no en pausa. Un día en pausa es **neutro** aunque tenga registro.
- **Diaria:** días programados = todos. **Días fijos:** días programados = los de la regla; los demás se ignoran (un registro en un día no programado se guarda y se muestra, pero no cuenta).
- **Racha diaria / días fijos:** se recorren hacia atrás los días programados y disponibles. Hoy cuenta si está cumplido y, si no, no rompe (el día no terminó): se empieza por el anterior. La racha es la cantidad de días cumplidos seguidos hasta el primero programado, disponible y no cumplido, o hasta `start_date`. Unidad: días.
- **X por semana:** una semana se cumple si sus **días cumplidos y disponibles** son ≥ su cuota, donde cuota = `ceil(X × disponibles / 7)` (una semana con pausa o que empieza a mitad de semana pide la parte proporcional; con 0 disponibles es neutra). Cada día cuenta una sola vez.
- **Racha semanal:** semanas cumplidas seguidas hacia atrás, saltando las neutras. La **semana actual** suma si ya se cumplió y, si no, no rompe hasta que termine el domingo. Unidad: semanas.
- **Racha de un hábito a evitar (días limpios):** días disponibles seguidos sin recaída hacia atrás, **contando hoy** mientras no haya recaída ("12 días limpio"); una recaída hoy la deja en 0 y el pad lo dice sin rojo ("Empiezas de nuevo hoy"). Las pausas son neutras igual que en el resto. **Decisión para revisar con el owner** (contar hoy desde que empieza).
- **Mejor racha:** la más larga del historial, con las mismas reglas.
- **Cumplimiento** (vista Semana y calendario): en diaria y días fijos, programados cumplidos / programados disponibles transcurridos; en X por semana, días cumplidos / cuota ("2 de 3"); en `avoid`, días limpios / días disponibles transcurridos.
- **Total de la semana** (encabezado de la vista Semana): la suma de lo cumplido sobre la suma de lo esperado de todos los hábitos activos ("18 de 24"), con las mismas reglas; en la semana actual solo cuentan los días transcurridos (y hoy, si ya se cumplió). Es la base de `getHabitsWeekSummary` para `weekly-review`.

La cuota proporcional y "neutro aunque tenga registro" son **decisiones para revisar con el owner** (cumplen "la pausa no rompe ni suma" de la forma más simple de explicar).

## Pantallas

Diseño con el design system: el patrón `HabitPad` (`Key` toggle + `Led` + sub "RACHA 8"/"HECHO"), `DotMatrix` y `DayCell` en una `Lcd`, `StatNumber` para rachas (NumberFlow) y `SegmentBar` para la cantidad. Si falta el estado "pasado sin cumplir" en `DayCell` (hoy: hecho, descanso, hoy, por venir), se pide en Claude Design y mientras tanto va en `overrides.css` con `PENDING UPSTREAM`.

**Hábitos (`/habits`)** con dos vistas (enlaces `?vista=`, como en tareas):

- **Hoy** (por defecto): una grilla de pads con los hábitos que tocan hoy (diarios, días fijos de hoy y los de X por semana), en el orden manual. Cada pad: LED del área, nombre, y abajo "RACHA 8" / "HECHO" en sí/no, o "3/8 vasos" con una barra corta en cantidad (y en la semanal, "2 de 3 esta semana"). Un hábito a evitar muestra "12 DÍAS LIMPIO" y su toque es "Registrar recaída: No fumar" (mismo aviso con "Deshacer", sin confirmación extra). Un toque registra (UI optimista, aviso con "Deshacer" ⌘Z, vibración en Android). Debajo, plegados: "No tocan hoy (N)" (días fijos de otros días; se pueden registrar igual) y "En pausa (N)" (con "Reanudar"). Encabezado con "Nuevo hábito" y el conteo en vivo ("4 de 6 hoy"). Estado vacío con una explicación y el botón para crear.
- **Semana:** el total de la semana arriba ("18 de 24 esta semana", `StatNumber`); debajo, cada hábito con sus 7 días (lunes a domingo) en `DotMatrix`, el cumplimiento ("5 de 7", "2 de 3") y "Semana anterior / siguiente" (enlaces `?semana=YYYY-MM-DD`, hasta la actual). Al final, la sección plegada "Archivados (N)" con "Reactivar".

**Detalle (`/habits/[id]`, página en ambos tamaños):**

- Cabecera: nombre, área, identidad, momento y "Editar". Estadísticas con `StatNumber`: racha actual, mejor racha, cumplimiento del mes y total acumulado ("Llevas 42 días hechos", principio 10).
- **Calendario del mes** (lunes primero, `?mes=YYYY-MM`, meses anteriores hasta `start_date`): cada día con su estado (hecho, parcial en cantidad con intensidad por `quantity/target`, en pausa, no programado, sin cumplir vacío, futuro). Cada día es un botón con nombre completo ("martes 29 de septiembre: 6 de 8 vasos"); los de la ventana de 7 días abren "Ajustar" para marcar o corregir. Navegable con flechas como una grilla (`role="grid"`).
- **Pausas:** las actuales y futuras, "Pausar" (hoja con fechas y motivo) y "Reanudar"; las pasadas, plegadas.
- Acciones: Archivar / Reactivar, Eliminar.

**Crear y editar (Sheet):** "Nombre" con el foco; "Tipo" (`SegmentedControl` A cumplir · A evitar; A evitar fija sí/no y diaria); "Medición" (`SegmentedControl` Sí/No · Cantidad; Cantidad muestra meta, unidad y paso); "Frecuencia" (Diaria · Por semana · Días fijos, con X o los días como teclas toggle) y el atajo "Varias veces al día"; "Área" opcional. En "Más detalles" (plegado): identidad, momento y fecha de inicio. Resumen legible en vivo ("Cada día · 8 vasos"). Guardar lleva a "Hoy" con el pad nuevo enfocado. Objetivo: crear en < 20 s en el celular.

**Navegación:** `habitsModule` (Hábitos, ícono `Repeat` como en `/design`, `/habits`, grupo `main`). Ubicación **provisional** hasta iterarla en Claude Design (como `tasks`): Hábitos toma la celda de la barra inferior que se le reservó (después de la tecla de captura, hoy de Tareas) y Tareas pasa a "Más"; en la barra lateral va después de Tareas, con el **atajo 4**. Decisión del owner (2026-10-02); la definitiva viene de Claude Design.

## Modelo de datos

```ts
// src/modules/habits/db/schema.ts (sketch)
export const HABIT_KINDS = ["build", "avoid"] as const;
export const HABIT_MEASURES = ["check", "quantity"] as const;
export const HABIT_FREQUENCIES = ["daily", "weekly_count", "weekdays"] as const;

export const habits = pgTable("habits", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                       // 1–80, normalized like names
  identity: text("identity"),                         // ≤ 120
  cue: text("cue"),                                   // ≤ 60, "Después del desayuno"
  kind: text("kind", { enum: HABIT_KINDS }).notNull().default("build"),
  lifeAreaId: uuid("life_area_id").references(() => lifeAreas.id, { onDelete: "restrict" }),
  measure: text("measure", { enum: HABIT_MEASURES }).notNull(),
  goal: integer("goal").notNull().default(1),         // 1 for check; 1–10 000 for quantity
  unit: text("unit"),                                 // 1–20, quantity only
  step: integer("step").notNull().default(1),         // 1–goal
  frequency: text("frequency", { enum: HABIT_FREQUENCIES }).notNull(),
  weeklyTarget: integer("weekly_target"),             // 1–6, weekly_count only
  weekdays: integer("weekdays").array(),              // ISO 1–7 strictly increasing, 1–6 items, weekdays only
  startDate: date("start_date").notNull(),
  sortOrder: integer("sort_order").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const habitLogs = pgTable("habit_logs", {
  habitId: uuid("habit_id").notNull().references(() => habits.id, { onDelete: "restrict" }),
  day: date("day").notNull(),                         // Lima day
  quantity: integer("quantity").notNull(),            // 0–99 999 (0 = unmarked; rows are never deleted)
  target: integer("target").notNull(),                // goal in force that day
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.habitId, t.day] })]);

export const habitPauses = pgTable("habit_pauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  habitId: uuid("habit_id").notNull().references(() => habits.id, { onDelete: "restrict" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),                // inclusive, ≤ start + 89
  reason: text("reason"),                             // ≤ 60
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- **`CHECK`** (en Drizzle, envueltos en `coalesce(…, false)` como `tasks_recurrence_check`): largos; en `avoid`, `measure = 'check'` y `frequency = 'daily'`; en `check`, `goal = 1`, `step = 1` y sin `unit`; en `quantity`, `unit` presente, `goal` 1–10 000 y `step` 1–`goal`; cada frecuencia con exactamente su campo (`weekly_target` 1–6; `weekdays` 1–6 elementos ISO estrictamente crecientes, una dimensión, sin nulos); `quantity` 0–99 999 y `target` ≥ 1 en los registros; `end_date >= start_date` y ≤ 90 días en las pausas.
- **Índices:** `habits (sort_order) WHERE deleted_at IS NULL AND archived_at IS NULL`; `habit_logs (habit_id, day)` es la PK (las lecturas por rango la usan); `habit_pauses (habit_id, start_date) WHERE deleted_at IS NULL`.
- **Registrar** es un *upsert* atómico (`INSERT … ON CONFLICT (habit_id, day) DO UPDATE SET quantity = least(greatest(habit_logs.quantity + delta, 0), 99999)`): dos toques seguidos suman dos, sin lock. En `check` la acción envía el estado deseado (`done: true/false`), así que es idempotente. La transacción lee el hábito `FOR SHARE` (ni archivado ni eliminado, día dentro de la ventana y ≥ `start_date`).
- **Bloqueos** (`HABITS_ADVISORY_SPACE = 4000`, la convención de dos claves de `projects`): `(4000, hashtext('habits:order'))` para crear, reordenar, archivar y reactivar (orden contiguo, como `LIFE_AREAS_LOCK`); `(4000, hashtext(<habit_id>))` para pausas (sin solapes), cambios de meta (con la actualización del `target` de hoy en adelante) y eliminar. Siempre el primer lock de la transacción, nunca después de un lock de fila; luego el hábito `FOR UPDATE`. Documentado junto al lock en el código.
- **Visibilidad:** `visibleHabit` (no eliminado) filtra toda lectura y escritura de hábitos, registros y pausas, como `visibleTask`; `activeHabit` agrega "no archivado".
- Migraciones aditivas; las tres tablas en `pnpm db:export` (con eliminados y archivados) y en el respaldo.

## Contratos

- **Con `today`:** `getHabitsTodaySummary(now)` (`src/modules/habits/contracts.ts`, `server-only`, con `requireOwner()`; sin owner redirige a `/login`) devuelve `HabitTodayItem[]` (tipo en `today-summary.ts`, puro) con los hábitos **activos** (ni archivados ni eliminados), con `start_date` ≤ hoy y **no en pausa hoy** que tocan hoy: diarios, días fijos que incluyen hoy y todos los de X por semana (también si la semana ya se cumplió). En el orden manual; `today` decide cómo separa pendientes y hechos. Cada elemento:
  - `id`, `name`, `area` (`{ id, name, color }` o `null`), `measure`, `goal`, `unit`, `step`;
  - `kind`; `quantity` (de hoy) y `done` (cumplido hoy; en X por semana, también `true` si la semana ya se cumplió; en `avoid`, `true` mientras no haya recaída hoy);
  - `week`: `{ done, quota }` solo en X por semana, si no `null`;
  - `streak`: `{ count, unit: "days" | "weeks" }`.
  - **Costo:** un número fijo de consultas (≤ 3: hábitos con el registro de hoy, registros cumplidos para las rachas, pausas), sin N+1; las rachas se calculan con las mismas funciones puras de `streak.ts`.
  - **Registrar desde `today`:** `today` depende de `habits`, así que puede importar el componente cliente `HabitPad` y las acciones `logHabit` / `setHabitDone` (`log-actions.ts`), que usan la cola, los avisos y el anunciador del anfitrión por `ScreenServicesContext` (`src/modules/core/components/screen-services.tsx`), como la sección de tareas en proyectos. Enlace con `habitPath(id)` (`routes.ts`).
- **`weekly-review` y `goals` (más adelante):** `weekly-review` leerá el cumplimiento de una semana (`getHabitsWeekSummary(weekStart)`, mismas reglas de "Rachas y cumplimiento") y `goals` enlazará metas a hábitos por `id` (p. ej. "90 días seguidos" leyendo la racha). Se definen en sus specs; aquí solo se garantiza que las reglas viven en funciones puras reutilizables.
- **Límites entre módulos:** `core`, `projects` y `tasks` nunca importan `@/modules/habits` (se agrega a la regla `no-restricted-imports` de `eslint.config.mjs`).

## Comandos y estructura

Los mismos de `SPEC-core`. Módulo en `src/modules/habits/`: `module.ts`, `db/schema.ts`, `habit-constants.ts`, `habit-input.ts` (Zod, client-safe), `schedule.ts` (puro: días programados, semana de Lima, ventana de registro), `streak.ts` (puro: rachas, cuotas y cumplimiento), `habits.ts` (`server-only`), `queries.ts`, `actions.ts`, `log-actions.ts`, `pause-actions.ts`, `today-summary.ts`, `contracts.ts`, `routes.ts`, `export.ts`, `habits-copy.ts`, `components/` (`HabitPad`, `HabitWeek`, `HabitCalendar`, `HabitFormSheet`, `AdjustDaySheet`, `PauseSheet`). Páginas en `src/app/(app)/habits/` (`page.tsx`, `[id]/page.tsx`, `[id]/not-found.tsx`).

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | Zod (medición, frecuencia, límites), `schedule.ts` (días programados, semana lunes–domingo, ventana de 7 días, medianoche de Lima, cambio de mes y de año), `streak.ts` con tablas de casos (cada frecuencia; hoy sin cumplir no rompe; semana actual; pausas en medio, al inicio y cubriendo una semana; cuota proporcional; `start_date` a mitad de semana; registro en día no programado o en pausa que no cuenta; meta cambiada con `target` histórico; mejor racha), componentes (pad, conteo, calendario como grilla) |
| Integración | Crear y editar (`CHECK` con inserts crudos), registrar (dos toques a la vez suman dos; `check` idempotente; tope 0–99 999; fuera de ventana, futuro, archivado o eliminado rechazado), ajustar un día pasado, meta nueva que actualiza solo hoy en adelante, pausas (solape rechazado con dos a la vez bajo el lock, con control positivo; reanudar), orden contiguo con lock, archivar y reactivar, eliminar y deshacer con `visibleHabit`, `getHabitsTodaySummary` (quiénes entran, orden, rachas, número fijo de consultas, autorización), exportación |
| E2E | Registrar con un toque en el celular en < 2 s y deshacer; cantidad que llega a la meta; varias veces al día; días fijos que no tocan hoy; pausar y reanudar; ajustar ayer desde el calendario; vista Semana; crear en < 20 s; axe en 0 en ambos temas y viewports (con `afterSaveSettled`); movimiento reducido; 320 px sin scroll horizontal; capturas con `expectScreenshot` |

## Límites

- **Siempre:** las de `SPEC-core`, `SPEC-projects` y `SPEC-tasks`, y las lecciones de `CLAUDE.md` (foco con `aria-disabled` durante el guardado, avisos que no tapan el control enfocado, hidratación antes de teclear en E2E, pruebas negativas con control positivo).
- **Preguntar primero:** dependencias nuevas (`canvas-confetti` y `@number-flow/react` solo si aún no están), avisos o notificaciones (son de `reminders`), gráficos más allá del calendario y la semana.
- **Nunca:** que `core`, `projects` o `tasks` importen `habits`; borrado físico; texto de culpa o rojo por incumplir; escribir en Notion.

## Criterios de éxito

1. **Un toque:** desde "Hoy" en el celular, tocar un pad da feedback visual en < 100 ms y el registro queda guardado en < 2 s (medido en E2E hasta la respuesta del servidor), con "Deshacer".
2. **Medición:** sí/no y cantidad (meta, unidad, paso) funcionan; un hábito a evitar registra recaídas y cuenta días limpios; "Varias veces al día" suma 1 por toque hasta N.
3. **Frecuencias:** diaria, X por semana y días fijos muestran en "Hoy" lo que toca hoy (día de Lima) y lo demás en "No tocan hoy".
4. **Rachas:** las reglas de "Rachas y cumplimiento" pasan sus tablas de casos para las tres frecuencias, con pausas y con la semana o el día en curso.
5. **Pausas y registro atrás:** pausar no rompe la racha; se puede registrar y corregir hasta 7 días atrás y no antes.
6. **Historial:** vista Semana con el total ("18 de 24") y calendario mensual por hábito con racha, mejor racha, cumplimiento y total.
7. **Datos:** archivar, reactivar, eliminar y deshacer; sin borrado físico; `CHECK` en la base; las tablas en `pnpm db:export` y el respaldo.
8. **Contrato:** `getHabitsTodaySummary(now)` con un número fijo de consultas y probado contra la base.
9. **Calidad:** CI en verde; axe en 0 en ambos temas; con `prefers-reduced-motion: reduce` no hay desplazamientos, escalas ni confeti; ningún texto de culpa (revisión del copy).

## Decisiones cerradas (2026-10-02)

1. **Sin importación** desde el Habit tracker de Notion: se empieza de cero.
2. **Medición:** sí/no (un toque marca el día) o cantidad con meta numérica y unidad; los toques y valores se suman durante el día y se cumple al llegar a la meta.
3. **Frecuencias:** diaria, X veces por semana (cualquier día) y días fijos de la semana. **Varias veces al día** = hábito diario de cantidad con unidad "veces" y meta N, donde cada toque suma 1 (p. ej. "Medicación, 2 veces al día"). Las franjas (mañana/noche) quedan para `reminders`.
4. **Rachas con pausa:** pausar por un rango de fechas; los días en pausa no rompen ni suman. Registro atrás hasta 7 días (también corregir la cantidad de un día pasado). Rachas por frecuencia según "Rachas y cumplimiento"; semanas desde el lunes, días de Lima.
5. **Navegación provisional:** Hábitos en la barra inferior (celda reservada) y Tareas a "Más"; atajo 4 en la barra lateral. La definitiva se itera en Claude Design.
6. **Hábitos a evitar en v1:** se registra la recaída y la racha cuenta los días limpios.
7. **Total de la semana** en la vista Semana ("18 de 24"); `weekly-review` lo reutilizará.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec.

- **H1 — Datos, crear y registrar con un toque:** las tres tablas (con `kind`), `CHECK`, locks y exportación; crear un hábito sí/no diario; `/habits` "Hoy" con pads, toque optimista y "Deshacer"; manifiesto provisional; eliminar y deshacer. Deja los slots (contexto de pantalla, pad, formulario) para H2–H5.
- **H2 — Frecuencias y agenda:** X por semana y días fijos; qué toca hoy; "No tocan hoy"; editar; orden manual; archivar y reactivar.
- **H3 — Cantidad, varias veces al día y a evitar:** meta, unidad y paso; `target` por día; "Ajustar"; el atajo "Varias veces al día"; tipo "A evitar" (recaída).
- **H4 — Rachas y pausas:** `streak.ts`; racha en el pad (la mejor racha va en el detalle de H5, como dice "Detalle"); pausas (crear, reanudar, sin solapes); registro y corrección hasta 7 días atrás; hitos de racha.
- **H5 — Historial:** vista Semana con `DotMatrix` y el total de la semana; detalle con calendario mensual, estadísticas y pausas pasadas; "Archivados".
- **H6 — Contrato con `today` y navegación:** `getHabitsTodaySummary`, `HabitPad` y acciones reutilizables desde `today`; navegación definitiva cuando llegue el diseño de Claude Design.

H2 y H3 pueden ir en paralelo sobre los slots de H1 (cada uno con su `TEST_DB_PORT` y `E2E_PORT`); H4 necesita las dos.

## Preguntas abiertas

Ninguna: las tres del borrador v1 las respondió el owner (2026-10-02, decisiones cerradas 5–7). Quedan las marcadas como **decisión para revisar con el owner**.
