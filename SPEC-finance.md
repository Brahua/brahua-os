# Spec: finance

> Módulo `finance` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` (avisos push/email con `reminders` después) · `today` lo consume · Estado: **BORRADOR v1** (2026-10-05), pendiente de aprobación del owner.

## Objetivo

Dejar Notion: llevar en brahua-os los **pagos recurrentes**, los **gastos del día a día** y un **resumen del mes**, rápido desde el celular.

- **Pagos recurrentes** (lo que hoy se usa en Notion): cada pago fijo con su ciclo, monto previsto, moneda, medio de pago y categoría. Se ve qué vence y se marca "Pagado" con un toque. Eso registra el gasto real del período.
- **Gastos sueltos:** registrar uno en **< 10 s y ≤ 3 interacciones** desde cualquier pantalla (`docs/principios-ux.md`, principio 1 y criterio 2), con la tecla de captura.
- **Resumen mensual:** cuánto se gastó en el mes (en PEN), por categoría y por medio de pago, y cuánto falta pagar de lo recurrente.
- **Portada:** una sección "Pagos" en `/` con lo vencido y lo que vence en los próximos 7 días, para pagar ahí mismo.
- **Importación única desde Notion** de los recurrentes (activos e inactivos), las categorías y los medios de pago.

Lo que hay hoy en Notion (base "Gastos", leída el 2026-10-05): 33 recurrentes (16 activos), todos mensuales con "día de pago", siempre en "Pendiente" (no se marca el pago de cada mes); 33 gastos sueltos en tres meses aislados (2023-08, 2024-10 y 2025-10), es decir, el registro diario se abandonó (principio "registrar costaba demasiado"); 13 categorías y 9 medios de pago.

Fuera de este módulo: avisos push/email de vencimiento (`reminders`), ingresos y balance, presupuestos o topes por categoría (`budget`, en "Más adelante"), inversiones, cuentas y saldos, conciliación bancaria, tarjetas con fecha de corte, tipo de cambio automático y escribir en Notion.

### Historias de usuario

1. Compro un café: aprieto la tecla de captura, elijo "Gasto", escribo `12.50` y Enter. Queda con la fecha de hoy, el último medio de pago usado y "Sin categoría", con "Deshacer". Si quiero, toco "Más" y pongo la categoría.
2. El día 8 abro la app: en la portada, "Pagos" muestra Netflix y Spotify ("Vence hoy"). Toco "Pagado" en Netflix: se registra S/ 50 con Crédito BCP y desaparece de la lista, con "Deshacer".
3. "Alimento" varía cada mes: toco "Pagado…" y ajusto el monto a S/ 1 080 antes de confirmar.
4. Claude se cobra en dólares: el pago está en USD 95, se paga con "Débito dólares BCP" y el resumen lo suma en soles con el tipo de cambio de Ajustes.
5. Un seguro se paga una vez al año en marzo: lo creo como anual, el 23 de marzo, y solo aparece ese mes.
6. Cancelo una suscripción: la archivo y deja de aparecer, pero sus pagos pasados siguen en el resumen.
7. A fin de mes veo "Octubre: S/ 9 820" con la barra por categoría y "Faltan S/ 1 250 de pagos recurrentes".
8. Un pago no corresponde este mes (p. ej. me lo cubrió otra persona): "Omitir este mes" lo saca de pendientes sin registrar gasto.

## Decisiones

**Del owner (2026-10-05):**

| Tema | Decisión |
|---|---|
| Alcance v1 | Pagos recurrentes, gastos del día a día y resumen mensual. Sin ingresos. |
| Moneda | Cada pago y gasto guarda su moneda (PEN o USD). El resumen convierte a PEN con un **tipo de cambio manual** que el owner fija en Finanzas. Sin servicios externos. |
| Ciclos | Semanal (un día de la semana), mensual (día X), cada N meses (día X, desde un mes de inicio) y anual (día y mes). |
| Pagar | "Pagado" **crea el gasto del período** con el monto previsto (editable antes de confirmar), la fecha de hoy y el medio del pago. El resumen lo cuenta una sola vez. "Deshacer" lo borra. |
| Importación | Script único con ids deterministas que corre el agente contra producción (respaldo previo y confirmación), con los datos leídos de Notion por el MCP (solo lectura). |
| Importar | Recurrentes activos (como activos) e inactivos (como archivados), 13 categorías y 9 medios de pago. **No** los 33 gastos sueltos. |
| Áreas de vida | No: `finance` tiene sus categorías propias. |
| Modo de trabajo | Autónomo hasta el Checkpoint final, que el agente recorre en producción con el Chrome del owner. |

**Autónomas, para revisar con el owner** (opción conservadora):

| Tema | Decisión | Por qué |
|---|---|---|
| Captura rápida | La hoja de la tecla de captura gana un selector **"Tarea · Gasto"** (`SegmentedControl`) que recuerda la última elección en el dispositivo. "Gasto": monto (teclado decimal, enfocado), descripción opcional y "Más" para categoría, medio, moneda y fecha. Enter guarda. | Criterio 2 de los principios (≤ 3 interacciones). La tecla es de `core`; el contexto pasa de un proveedor a una lista ordenada (`tasks`, `finance`). |
| Valores por defecto | Fecha: hoy (Lima). Medio: el último usado en un gasto. Moneda: la del medio (cada medio tiene moneda por defecto: "Débito dólares BCP" en USD). Categoría: ninguna ("Sin categoría"). | Lo mínimo para guardar es el monto. |
| Monto | Decimal con 2 decimales, > 0 y ≤ 1 000 000, guardado en **céntimos** (`bigint`). Se acepta coma o punto. Se muestra con `Intl.NumberFormat("es-PE")`: "S/ 1 250.00", "US$ 95.00". | Sin errores de coma flotante. |
| Monto variable | Un recurrente puede no tener monto previsto ("Monto variable", p. ej. luz o agua). Al pagarlo, la hoja pide el monto. | En Notion "Seguro de Salud (Josue)" no tiene monto; hay servicios que varían. |
| Tipo de cambio | Un valor (PEN por 1 USD, 4 decimales, entre 1 y 10) en Finanzas → "Ajustes". Cada gasto en USD **guarda el tipo vigente al registrarlo** (`exchange_rate`), así que cambiarlo no reescribe meses pasados; editar un gasto en USD no cambia su tipo salvo que se cambie la moneda o el monto. Sin tipo fijado, los gastos en USD se suman aparte ("+ US$ 95.00 sin convertir") y Finanzas invita a fijarlo. | Historia estable y sin servicio externo. |
| Vencimientos | Fecha de vencimiento de cada período calculada por funciones puras (`schedule.ts`). Día 29–31 en un mes más corto: el último día del mes. Semanal: un día ISO (lunes = 1). | Como `tasks` (T3) con "el día X del mes". |
| Pendientes | Un período está **pendiente** si su vencimiento es ≥ la fecha de inicio del pago y no tiene registro "pagado" ni "omitido". Se consideran solo los vencidos de los **últimos 60 días**; más atrás se dejan de mostrar (sin culpa). | Evitar listas de deuda infinitas al importar o al volver de un viaje. |
| Inicio al importar | Los activos importados empiezan en su próximo vencimiento desde el día de la importación: nada aparece vencido el primer día. | El historial de Notion nunca se marcó; no hay qué arrastrar. |
| Pagar antes de tiempo | "Pagado" se ofrece para el período más antiguo pendiente y para el próximo si vence en ≤ 7 días. Pagar el próximo no cambia los siguientes. | Pagos que se adelantan unos días. |
| Omitir | "Omitir este período" marca el período como omitido, sin gasto, con "Deshacer". | Historia 8. |
| Fecha del gasto pagado | Hoy (Lima), editable en la hoja de "Pagado…". El gasto cuenta en el mes de **su fecha**, no del vencimiento. | Es lo que salió de la cuenta ese día. |
| Tarjetas de crédito | Un gasto con tarjeta cuenta el día de la compra. Sin fechas de corte. | Simple; fuera de alcance. |
| Categorías y medios | Lista propia con nombre (1–40), orden manual y archivo (sin borrado físico). Un medio tiene además moneda por defecto. Se gestionan en Finanzas → "Ajustes". Archivar no toca los gastos que la usan. | Como las áreas de `core`. |
| Eliminar | Gastos y pagos recurrentes: eliminado lógico con "Deshacer" (`deleted_at`). Eliminar un recurrente no elimina sus gastos pasados (quedan con su nombre). | Regla de `core`: nunca borrado físico. |
| Resumen | El mes de Lima: total en PEN, barras por categoría (CSS, sin librería de gráficos), por medio de pago, recurrente vs suelto, y "Pendiente de pagar" (recurrentes pendientes que vencen en el mes). Navegación mes anterior / siguiente. Sin comparaciones de "gastaste más": solo el dato. | Principios: sin culpa; Recharts pide OK (dependencia nueva). |
| Navegación | "Finanzas" (`/finance`), atajo 5, grupo principal después de Hábitos. En la barra inferior queda en "Más" hasta la navegación definitiva (Claude Design). | Como Tareas y Hábitos (provisional). |
| Copy | "Vence hoy", "Vence el jue 9", "Venció hace 3 días" con el color de señal (naranja con LED), nunca rojo ni "atrasado". | `docs/principios-ux.md`, "Lo que no haremos". |

## Pantallas

**`/finance`** con un `SegmentedControl` **"Mes · Pagos"** (se recuerda por dispositivo):

- **Mes** (por defecto): cabecera con el mes ("Octubre 2026", flechas anterior/siguiente; no más allá del mes actual) y el total en PEN (`NumberFlow`). Debajo:
  1. Tira "Pendiente de pagar: S/ 1 250 · 2 pagos" (enlaza a Pagos) si hay.
  2. **Por categoría:** barras horizontales con nombre, monto y porcentaje; "Sin categoría" al final. Tocar una filtra la lista.
  3. **Por medio de pago:** filas compactas con monto.
  4. **Gastos del mes:** lista por día (más reciente arriba): descripción (o la categoría si no hay), monto en su moneda (y "≈ S/" si es USD), medio, marca "Recurrente". Tocar abre la hoja de edición (eliminar con "Deshacer").
  5. Botón "Registrar gasto" (abre la misma hoja que la captura).
- **Pagos:** 
  1. **Pendientes:** vencidos (≤ 60 días) y los que vencen en 7 días, por fecha, con "Pagado" (un toque si tiene monto, abre la hoja si es variable), menú "Pagado…" (ajustar monto, fecha, medio) y "Omitir este período".
  2. **Este mes:** cada recurrente activo con su vencimiento del mes y estado (pagado con el monto real / pendiente / omitido / no toca este mes).
  3. **Todos:** activos por próximo vencimiento, con ciclo ("Mensual, día 15", "Anual, 23 mar"), monto y medio; "Nuevo pago recurrente"; tocar abre su página.
  4. **Archivados** plegados (reactivar).
- **Ajustes** (botón en la cabecera, hoja): tipo de cambio, categorías y medios de pago (crear, renombrar, ordenar, archivar).

**`/finance/payments/[id]`:** nombre, ciclo, monto, medio, categoría, notas (≤ 500), próximos 3 vencimientos, historial de períodos (pagado con monto y fecha, omitido) y acciones: editar, archivar/reactivar, eliminar.

**Hojas:** "Gasto" (crear/editar), "Pago recurrente" (crear/editar: nombre, ciclo y su detalle, monto o "variable", moneda, medio, categoría, inicio), "Pagado…" (monto, fecha, medio).

En el celular las acciones van abajo (principio 14); los montos usan IBM Plex Mono con cifras tabulares.

## Modelo de datos

```ts
// src/modules/finance/db/schema.ts (sketch)
export const CURRENCIES = ["PEN", "USD"] as const;
export const PAYMENT_CYCLES = ["weekly", "monthly", "every_n_months", "yearly"] as const;
export const SETTLEMENT_STATUSES = ["paid", "skipped"] as const;

export const financeCategories = pgTable("finance_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                       // 1–40, unique among visible (lower)
  sortOrder: integer("sort_order").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financePaymentMethods = pgTable("finance_payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                       // 1–40, unique among visible (lower)
  currency: text("currency", { enum: CURRENCIES }).notNull().default("PEN"),
  sortOrder: integer("sort_order").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeRecurringPayments = pgTable("finance_recurring_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),                       // 1–80
  amountCents: bigint("amount_cents", { mode: "number" }), // null = variable; 1–100 000 000
  currency: text("currency", { enum: CURRENCIES }).notNull(),
  categoryId: uuid("category_id").references(() => financeCategories.id, { onDelete: "restrict" }),
  paymentMethodId: uuid("payment_method_id").references(() => financePaymentMethods.id, { onDelete: "restrict" }),
  cycle: text("cycle", { enum: PAYMENT_CYCLES }).notNull(),
  weekday: integer("weekday"),                        // 1–7, weekly only
  dayOfMonth: integer("day_of_month"),                // 1–31, monthly / every_n_months / yearly
  intervalMonths: integer("interval_months"),         // 2–12, every_n_months only
  anchorMonth: integer("anchor_month"),               // 1–12: every_n_months (first month) and yearly (the month)
  startDate: date("start_date").notNull(),            // first due date counted
  notes: text("notes"),                               // ≤ 500
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeExpenses = pgTable("finance_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  description: text("description"),                  // ≤ 80
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(), // 1–100 000 000
  currency: text("currency", { enum: CURRENCIES }).notNull(),
  exchangeRate: numeric("exchange_rate", { precision: 8, scale: 4 }), // PEN per USD at save; USD only
  spentOn: date("spent_on").notNull(),                // Lima day
  categoryId: uuid("category_id").references(() => financeCategories.id, { onDelete: "restrict" }),
  paymentMethodId: uuid("payment_method_id").references(() => financePaymentMethods.id, { onDelete: "restrict" }),
  recurringPaymentId: uuid("recurring_payment_id").references(() => financeRecurringPayments.id, { onDelete: "restrict" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per settled period of a recurring payment (paid → its expense; skipped → none).
export const financeSettlements = pgTable("finance_settlements", {
  recurringPaymentId: uuid("recurring_payment_id").notNull().references(() => financeRecurringPayments.id, { onDelete: "restrict" }),
  dueOn: date("due_on").notNull(),
  status: text("status", { enum: SETTLEMENT_STATUSES }).notNull(),
  expenseId: uuid("expense_id").references(() => financeExpenses.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.recurringPaymentId, t.dueOn] })]);

export const financeSettings = pgTable("finance_settings", {
  id: integer("id").primaryKey().default(1),          // single row, CHECK id = 1
  usdToPen: numeric("usd_to_pen", { precision: 8, scale: 4 }), // 1–10; null = not set
  lastPaymentMethodId: uuid("last_payment_method_id").references(() => financePaymentMethods.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- **`CHECK`** (con `coalesce(…, false)` como `tasks_recurrence_check`): largos; montos 1–100 000 000 céntimos; cada ciclo con exactamente sus campos (`weekly` → `weekday`; `monthly` → `day_of_month`; `every_n_months` → `day_of_month`, `interval_months`, `anchor_month`; `yearly` → `day_of_month`, `anchor_month`); `exchange_rate` presente si y solo si `currency = 'USD'`, entre 1 y 10; `paid` ⇔ `expense_id` presente; settings con `id = 1`.
- **Índices:** `finance_expenses (spent_on) WHERE deleted_at IS NULL`; `finance_expenses (recurring_payment_id) WHERE deleted_at IS NULL`; únicos por `lower(name)` entre los no archivados en categorías y medios; `finance_recurring_payments (archived_at) WHERE deleted_at IS NULL`.
- **Pagar** en una transacción: lock del pago, inserta el gasto y el `settlement` (`paid`); un segundo "Pagado" del mismo período choca con la PK y responde "Ya estaba pagado" (idempotente, sin gasto doble). "Deshacer" elimina el gasto (lógico) y borra el `settlement` (la única fila que se borra físicamente: es un estado, no un dato del owner; queda documentado junto al código). Eliminar un gasto pagado de un recurrente hace lo mismo: el período vuelve a pendiente.
- **Bloqueos** (`FINANCE_ADVISORY_SPACE = 5000`, dos claves como `projects`): `(5000, hashtext('finance:categories'))` y `(5000, hashtext('finance:methods'))` para crear, ordenar y archivar; `(5000, hashtext(<recurring_id>))` para pagar, omitir, deshacer y editar el ciclo. Siempre el primer lock de la transacción.
- **Visibilidad:** `visibleExpense` y `visibleRecurring` (no eliminados) filtran toda lectura y escritura; un gasto de un recurrente eliminado sigue visible.
- Migraciones aditivas; todas las tablas en `pnpm db:export` (con eliminados y archivados) y en el respaldo semanal.

## Importación desde Notion

- El agente lee la base "Gastos" (`Etiqueta = Gastos recurrentes`), "Categoría" y las opciones de "Tipo de pago" con el MCP de Notion (solo lectura) y escribe un JSON en **un archivo fuera del repo** (el repo es público hasta ~2026-11-01: los datos financieros **nunca** se versionan; `.gitignore` cubre `/.data/`).
- `scripts/finance-import.ts` (`pnpm db:finance:import <archivo>`): valida el JSON con Zod, ids deterministas (UUID v5 a partir del id de Notion), una transacción, idempotente (volver a correrlo no duplica), confirmación con el host y una palabra, y respaldo comprobado antes (lecciones de `today`). Mapeo: "Monto" → PEN (como está en Notion; el owner cambia a USD lo que corresponda), "Fecha de pago" → mensual con ese día, "Activo" no → archivado, sin monto → variable, "Tipo de pago" → medio (los "dólares" en USD).
- Los datos de demo no incluyen finanzas: `finance` empieza con datos reales. `db:demo:remove` no toca las tablas `finance_*`.

## Contratos

- **Con `today`:** `getFinanceTodaySummary(now)` (`src/modules/finance/contracts.ts`, `server-only`, con `requireOwner()`) devuelve los períodos **pendientes** de recurrentes activos vencidos (≤ 60 días) o que vencen en los próximos 7 días, por fecha: `{ recurringId, name, dueOn, amountCents | null, currency, paymentMethod: { id, name } | null }`. Número fijo de consultas (≤ 2). `today` agrega la sección **"Pagos"** después de Tareas y antes de Proyectos: filas con nombre, "Vence hoy" / "Venció hace N días" / "Vence el jue 9", monto y botón "Pagado" (un toque, o la hoja si es variable), con los servicios de pantalla del anfitrión. La acción `markPaid` y la fila cliente las exporta `finance` (como `TaskTodayRow`). Pagos pendientes cuentan para "Día completo": solo los **vencidos o de hoy** lo impiden, los próximos no. `finance` revalida `/`.
- **Con `core` (captura rápida):** `QuickCaptureContext` pasa a una lista ordenada de proveedores (`tasks`, `finance`); con más de uno, la hoja muestra el selector. `core` sigue sin importar módulos: la raíz de composición (`src/lib/capture-providers.tsx`) los nombra.
- **Con `reminders` (después):** `getUpcomingPayments(from, to)` dará los vencimientos pendientes del rango para programar avisos; se define en la spec de `reminders`. Aquí solo se garantiza que el cálculo vive en `schedule.ts` (puro).
- **Límites:** `core`, `projects`, `tasks` y `habits` nunca importan `@/modules/finance`; `finance` no importa otros módulos salvo `core` (regla en `eslint.config.mjs`).

## Comandos y estructura

Los mismos de `SPEC-core`, más `pnpm db:finance:import <archivo>`. Módulo en `src/modules/finance/`: `module.ts`, `db/schema.ts`, `finance-constants.ts`, `money.ts` (puro: parsear, céntimos, formato, conversión), `schedule.ts` (puro: vencimientos, períodos pendientes, mes de Lima), `summary.ts` (puro: agregados del mes), `expense-input.ts` / `recurring-input.ts` / `catalog-input.ts` (Zod, client-safe), `expenses.ts`, `recurring.ts`, `catalog.ts` (`server-only`), `queries.ts`, `actions.ts`, `payment-actions.ts`, `catalog-actions.ts`, `contracts.ts`, `routes.ts`, `export.ts`, `revalidate.ts`, `finance-copy.ts`, `components/`. Páginas en `src/app/(app)/finance/` (`page.tsx`, `payments/[id]/page.tsx`, `payments/[id]/not-found.tsx`).

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | `money.ts` (coma y punto, 2 decimales, límites, redondeo, formato `es-PE`, conversión con el tipo guardado, sin tipo), `schedule.ts` con tablas de casos (cada ciclo; día 31 en febrero y en años bisiestos; cada 3 meses cruzando el año; anual; semanal; inicio a mitad de período; ventana de 60 días; pendientes con pagados y omitidos; medianoche de Lima), `summary.ts` (por categoría, medio, recurrente vs suelto, USD convertido y sin convertir, eliminados fuera), Zod, componentes (hoja de gasto con teclado, selector de captura, barras accesibles) |
| Integración | `CHECK` con inserts crudos; crear/editar/eliminar/deshacer gastos; pagar (dos "Pagado" a la vez → un solo gasto, con control positivo), omitir, deshacer, eliminar el gasto pagado; catálogo con lock (orden contiguo, nombre único); tipo de cambio guardado por gasto; `getFinanceTodaySummary` (quiénes entran, orden, número fijo de consultas, autorización); exportación; script de importación contra la base desechable (idempotente, mapeo, archivados) |
| E2E | Capturar un gasto en ≤ 3 interacciones y < 10 s en el celular, con "Deshacer"; pagar desde Pagos y desde `/` (con `@today-*` como manda la lección de `today`); pago variable; omitir; resumen del mes con un gasto en USD; navegar meses; Ajustes (tipo de cambio, categoría nueva, archivar); axe en 0 en ambos temas y viewports (con `afterSaveSettled`); movimiento reducido; 320 px sin scroll horizontal; capturas con `expectScreenshot` |

## Límites

- **Siempre:** las de `SPEC-core` y los módulos anteriores, y las lecciones de `CLAUDE.md` (`ownerAction`/`requireOwner`, foco con `aria-disabled`, foco restaurado, avisos que no tapan el control, locks de dos claves primero, hidratación antes de teclear, datos compartidos serializados en E2E).
- **Preguntar primero:** dependencias nuevas (Recharts, librerías de dinero), servicios externos (tipo de cambio), escribir en producción fuera del script de importación aprobado, cualquier cambio destructivo.
- **Nunca:** versionar datos financieros reales (repo público); escribir en Notion; borrado físico de datos del owner; montos en coma flotante; texto de culpa o rojo por vencidos; que otro módulo (salvo `today`) importe `finance`.

## Criterios de éxito

1. **Captura:** un gasto desde cualquier pantalla del celular en ≤ 3 interacciones y < 10 s (E2E), con "Deshacer".
2. **Recurrentes:** los cuatro ciclos calculan bien sus vencimientos (tablas de casos); "Pagado" crea exactamente un gasto por período, también con dos toques a la vez; omitir y deshacer funcionan.
3. **Portada:** `/` muestra en "Pagos" lo vencido y lo de los próximos 7 días, y se paga con un toque; "Día completo" lo respeta.
4. **Resumen:** el total del mes en PEN coincide con la suma de los gastos (USD con su tipo guardado); por categoría y por medio; "Pendiente de pagar" correcto.
5. **Importación:** los 33 recurrentes (16 activos, 17 archivados), 13 categorías y 9 medios en producción, sin vencidos el primer día y sin datos en el repo.
6. **Datos:** sin borrado físico (salvo el estado de período documentado); `CHECK` en la base; tablas en `pnpm db:export` y en el respaldo.
7. **Calidad:** CI en verde; axe en 0 en ambos temas; con `prefers-reduced-motion: reduce` no hay desplazamientos ni escalas; ningún texto de culpa.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec.

- **F1 — Datos y gastos sueltos:** las seis tablas, `CHECK`, locks y exportación; catálogo (categorías, medios) y tipo de cambio en "Ajustes"; `/finance` → Mes con la lista de gastos; hoja "Gasto" (crear, editar, eliminar, deshacer); captura rápida "Tarea · Gasto"; manifiesto y navegación provisional. Deja los slots de Pagos, el resumen y "Pendiente de pagar".
- **F2 — Pagos recurrentes:** `schedule.ts`; crear/editar/archivar/eliminar; vista Pagos (pendientes, este mes, todos, archivados); "Pagado", "Pagado…", omitir y deshacer; página del pago.
- **F3 — Resumen mensual:** `summary.ts`; total, barras por categoría, por medio, recurrente vs suelto, "Pendiente de pagar"; navegación de meses.
- **F4 — Portada:** `getFinanceTodaySummary`, sección "Pagos" en `today`, "Día completo".
- **F5 — Importación:** script, lectura de Notion, corrida en producción con respaldo previo.

F2 y F3 pueden ir en paralelo sobre los slots de F1 (cada uno con su `TEST_DB_PORT` y `E2E_PORT`); F4 necesita F2; F5 necesita F2.

## Preguntas abiertas

Ninguna bloqueante: las del borrador las respondió el owner (2026-10-05). Quedan las decisiones de la tabla "Autónomas, para revisar con el owner"; las más visibles son el selector "Tarea · Gasto" en la tecla de captura, la ventana de 60 días para vencidos y que los activos importados empiecen sin vencidos.
