# Tareas: finance-email (gastos desde correos)

> Plan: [`finance-email-plan.md`](finance-email-plan.md) · Spec: [`SPEC-finance-email.md`](../../SPEC-finance-email.md). **Cerrado el 2026-10-14.**

Spec: [`SPEC-finance-email.md`](../SPEC-finance-email.md) (aprobada el 2026-10-14) · Plan: [`plan.md`](plan.md). Cada tarea termina con el gate local liviano en verde, un PR con los 3 checks verdes y el deploy con smoke. Commits en inglés (`feat(finance): …`). Máximo **una** E2E nueva en todo el módulo.

- [x] **E1: Datos y endpoint** (M; PR #129)
  - Migración aditiva: tabla `finance_email_suggestions` (`gmail_message_id` único, `source`, `kind`, `status`, `amount_cents`, `currency`, `merchant`, `occurred_on`, `card_last4`, `method_hint`, `subject`, `sender_verified`, `expense_id`, `created_at`, `decided_at`), `last4` en `finance_payment_methods` y «Mis nombres» (lista en ajustes de finanzas); Prettier sobre el snapshot de Drizzle; exportación y respaldo.
  - `FINANCE_EMAIL_SECRET` (≥ 32) validado por nombre en `env.ts`; `POST /api/finance/email-ingest` con el orden secreto (tiempo constante) → tamaño (≤ 128 KB) → JSON → Zod → remitente/asunto conocido → escribir; `INSERT … ON CONFLICT DO NOTHING` antes de interpretar; tipo `Reading` y un parser de juguete que fija el contrato.
  - **Aceptación:** sin secreto, con secreto equivocado o > 128 KB se rechaza antes de tocar la base de datos; el mismo mensaje tres veces deja una fila; dos ids distintos dejan dos; el cuerpo no se guarda ni se loguea.
  - **Verificación:** unitarias del esquema y del orden de validaciones; integración (una a la vez) de idempotencia con control positivo, carrera de dos lotes y `CHECK` con inserts crudos; revisión de seguridad (`security-auditor`); gate liviano.
  - **Archivos:** schema + migración, `env.ts`, ruta, `email/ingest.ts`, `email/types.ts` (~5).
- [x] **E2: Parsers por formato** (M; `feat/finance-email-e2`; la migración `0020` deja descartar un «No pude leerlo») — depende de E1
  - Funciones puras en `src/modules/finance/email/parsers/`: consumo BCP (crédito y débito, `PLIN-` limpio), consumo BBVA, pago Yape, transferencia a terceros BCP, Plin BBVA (incluido «con QR») e interbancaria BBVA; `parseSpanishDateTime` y montos en las formas observadas; **ignorados**: pago de tarjeta propia, entre cuentas propias, puntos, estados de cuenta, comprobantes, promociones, recibidos; pase a «Mis nombres» se ignora.
  - Nota de seguridad de E1: las filas `unreadable` guardadas antes de E2 no se vuelven a leer (`ON CONFLICT DO NOTHING`): E2 añade la ruta de re-lectura (o el script reenvía solo lo no etiquetado). El rango de fechas y `cleanText` de `parsers/text.ts` se reutilizan en cada parser.
  - **Aceptación:** cada formato da monto, moneda, comercio o destinatario, fecha de Lima y últimos 4 correctos; lo desconocido devuelve `null` (→ «No pude leerlo») y nunca lanza; un lote con un correo ilegible no rompe a los demás.
  - **Verificación:** unitarias con fixtures **anonimizados** (montos y nombres inventados con el mismo formato; los correos reales no entran al repo), incluidos AM/PM, 24 h, `1,000.50`, USD, `&amp;`, HTML en vez de texto; gate liviano.
  - **Archivos:** 6 parsers + `parsers/index.ts`, `dates.ts`, `amounts.ts`, fixtures (agrupar en dos PR si pasa de ~5 por área).
- [x] **E3: Bandeja, ajustes y E2E** (M/L; `feat/finance-email-e3`) — depende de E1 (y de E2 para datos reales)
  - Sección «Sugerencias» arriba de Finanzas (solo si hay): fila con monto, comercio/destinatario, fecha, medio sugerido por banco + últimos 4; «Registrar» (abre la hoja del gasto con lo leído), «Descartar» y «Deshacer» exacto (`suggestionId` + `expenseId`); «Posible duplicado» (mismo monto, moneda y día); «Remitente no verificado» sin registro directo; «No pude leerlo» con «Registrar a mano».
  - Finanzas → Ajustes: «Mis nombres» y «Últimos 4 dígitos» por medio de pago. Limpieza de decididas a los 90 días en el tick.
  - **El único E2E del módulo** `e2e/finance-email.spec.ts`: POST de un lote al endpoint de prueba, ver la sugerencia, registrar y comprobar el gasto en el mes; axe en ambos temas y 320 px con `afterSaveSettled`; entrada en `SPEC_MODULES` (`scripts/e2e-affected.mjs`); si lleva captura, `expectScreenshot` y `update-screenshots.yml` tras el push.
  - **Aceptación:** registrar crea exactamente un gasto y «Deshacer» no toca uno posterior; doble toque o dos pestañas no duplican; foco restaurado y `aria-disabled` mientras guarda; sin cadenas de culpa ni rojo.
  - **Verificación:** unitarias y de componente (registrar, descartar, deshacer, duplicado, no verificado, foco); integración de registrar/«Deshacer» exacto y autorización (`ownerAction`/`requireOwner`); gate liviano.
- [x] **E4a: Guía y script** (S; `feat/finance-email-e4`) — `docs/finance-email-setup.md`, `docs/finance-email-apps-script.js`, su prueba de deriva y la retrospectiva; **falta E4b**: el owner instala el script y el Checkpoint.
- [x] **E4b: Puesta en marcha y cierre** (S; hecha por el owner el 2026-10-14 con `docs/finance-email-setup.md`) — el owner genera el secreto, redeploy e instala el script; Checkpoint; archivar plan y tareas; mapa; marcar cerrado. Detalle de E4:
  - `docs/finance-email-setup.md` en español, verificada contra el código (variable, ruta, etiquetas, límites vigentes de Apps Script, resumen de fallos) y `docs/finance-email-apps-script.js` sin secretos: busca por remitente y asunto, manda texto plano ≤ 8 KB por correo con el resultado de autenticación, etiqueta `brahua-os/enviado`, solo llama si hay correos nuevos; disparador cada 5 min.
  - El owner genera el secreto en su terminal (`openssl rand … | vercel env add … --sensitive`) y lo pega en las propiedades del script; redeploy tras el cambio.
  - Retrospectiva en `CLAUDE.md`, backlog, nota en el mapa de capacidades y HANDOFF («Cómo funciona finance-email»), archivar plan y tareas.

- [x] **E5: Pagos recurrentes por correo** (M; `feat/finance-email-e5`; addendum de la spec aprobado) — depende de E3
  - Migración aditiva `email_aliases` en `finance_recurring_payments`; `recurring-match.ts` puro (alias aprendido > nombre + monto > solo nombre; empate = ninguno; misma moneda); `markSuggestionPaid` (candados: sugerencia y pago antes de cualquier fila; reutiliza `payPeriod` con el monto, el día y el medio del correo) y su «Deshacer» exacto (`undoPaidPeriod`); fila «Parece el pago de …» con «Marcar como pagado», «Registrar como gasto» y «Descartar»; estado «Ya pagado».
  - **Aceptación:** los seis criterios del addendum.
  - **Verificación:** unitarias del reconocedor (tildes, mayúsculas, palabras sueltas, empate, moneda); integración (una a la vez): pagar, deshacer, doble toque y dos a la vez, otro monto con alias, ya pagado, última cuota que archiva y «Deshacer» que reabre; componente de la fila; gate liviano. Sin E2E nueva.

- [x] **E6: Corregir el monto de un período ya pagado** (S; `feat/finance-email-e6`) — «Registraste X; el banco cobró Y» + «Corregir a Y» con «Deshacer»; integración y componente.

### Checkpoint final
- [x] El owner instaló el script y los correos reales llegaron a la bandeja (consumo BCP y BBVA, Yape, Plin). Dos arreglos del primer uso real: el aplanado de la tabla HTML de BCP (#133) y los asteriscos de negrita (#135).
- [x] Probado por el owner en producción con datos reales (registrar, deshacer, marcar como pagado, «Mis nombres»); sin datos `[QA]` que borrar.
- [x] Se cumplen los criterios de éxito de `SPEC-finance-email.md` (confirmado por el owner el 2026-10-14).
- [ ] Revisión con el owner de las decisiones autónomas.

### `finance-email` → backlog (fuera de v1)
- Mapa «comercio → categoría» aprendido de lo que el owner registra.
- Avisos de nuevas sugerencias por Telegram con botón «Registrar» (el owner dijo que basta la sección de Finanzas).
- Registro directo para formatos conocidos y completos (hoy todo pasa por confirmación).
- Interbank, Scotiabank u otro buzón que no sea Gmail.
