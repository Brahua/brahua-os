# Tareas

> Último módulo cerrado: **`household`** (2026-10-14; plan y tareas en [`archive/household-plan.md`](archive/household-plan.md) y [`archive/household-todo.md`](archive/household-todo.md)). **Siguiente: `health`** (sin spec todavía: se arranca con `spec-driven-development`). Planes y tareas de módulos cerrados en [`archive/`](archive/).

## Módulo `finance-email` (gastos desde correos): en curso

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
- [ ] **E3: Bandeja, ajustes y E2E** (M/L) — depende de E1 (y de E2 para datos reales)
  - Sección «Sugerencias» arriba de Finanzas (solo si hay): fila con monto, comercio/destinatario, fecha, medio sugerido por banco + últimos 4; «Registrar» (abre la hoja del gasto con lo leído), «Descartar» y «Deshacer» exacto (`suggestionId` + `expenseId`); «Posible duplicado» (mismo monto, moneda y día); «Remitente no verificado» sin registro directo; «No pude leerlo» con «Registrar a mano».
  - Finanzas → Ajustes: «Mis nombres» y «Últimos 4 dígitos» por medio de pago. Limpieza de decididas a los 90 días en el tick.
  - **El único E2E del módulo** `e2e/finance-email.spec.ts`: POST de un lote al endpoint de prueba, ver la sugerencia, registrar y comprobar el gasto en el mes; axe en ambos temas y 320 px con `afterSaveSettled`; entrada en `SPEC_MODULES` (`scripts/e2e-affected.mjs`); si lleva captura, `expectScreenshot` y `update-screenshots.yml` tras el push.
  - **Aceptación:** registrar crea exactamente un gasto y «Deshacer» no toca uno posterior; doble toque o dos pestañas no duplican; foco restaurado y `aria-disabled` mientras guarda; sin cadenas de culpa ni rojo.
  - **Verificación:** unitarias y de componente (registrar, descartar, deshacer, duplicado, no verificado, foco); integración de registrar/«Deshacer» exacto y autorización (`ownerAction`/`requireOwner`); gate liviano.
- [ ] **E4: Puesta en marcha y cierre** (S) — depende de E2 y E3
  - `docs/finance-email-setup.md` en español, verificada contra el código (variable, ruta, etiquetas, límites vigentes de Apps Script, resumen de fallos) y `docs/finance-email-apps-script.js` sin secretos: busca por remitente y asunto, manda texto plano ≤ 8 KB por correo con el resultado de autenticación, etiqueta `brahua-os/enviado`, solo llama si hay correos nuevos; disparador cada 5 min.
  - El owner genera el secreto en su terminal (`openssl rand … | vercel env add … --sensitive`) y lo pega en las propiedades del script; redeploy tras el cambio.
  - Retrospectiva en `CLAUDE.md`, backlog, nota en el mapa de capacidades y HANDOFF («Cómo funciona finance-email»), archivar plan y tareas.

### Checkpoint final
- [ ] El owner instala el script y un correo real de cada formato llega a la bandeja con lo leído correcto (consumo BCP y BBVA, Yape, transferencia, Plin).
- [ ] Recorrido en producción por el agente (Chrome del owner, datos `[QA]` borrados después).
- [ ] Se cumplen los criterios de éxito de `SPEC-finance-email.md`.
- [ ] Revisión con el owner de las decisiones autónomas.

### `finance-email` → backlog (fuera de v1)
- Mapa «comercio → categoría» aprendido de lo que el owner registra.
- Avisos de nuevas sugerencias por Telegram con botón «Registrar» (el owner dijo que basta la sección de Finanzas).
- Registro directo para formatos conocidos y completos (hoy todo pasa por confirmación).
- Interbank, Scotiabank u otro buzón que no sea Gmail.

## Módulo `weekly-review`: cerrado el 2026-10-14

Plan y tareas archivados en [`archive/weekly-review-plan.md`](archive/weekly-review-plan.md) y [`archive/weekly-review-todo.md`](archive/weekly-review-todo.md). W1–W4 en producción (#117–#120). **Siguiente: `household`** (Hogar, sin spec todavía) y después `health`.

## Módulo `household` (Hogar): cerrado el 2026-10-14

Plan y tareas archivados en [`archive/household-plan.md`](archive/household-plan.md) y [`archive/household-todo.md`](archive/household-todo.md). H1 limpieza (#124), H2 compras (#125) y H3 recetas con el E2E (#126) están en producción; H4 (cierre) trae el script de importación y este cierre. **Siguiente: `health`** (sin spec todavía: se arranca con `spec-driven-development`).

### `household` → backlog consolidado

- **Importar las limpiezas desde Notion (a pedido del owner):** el script `pnpm db:household:import <archivo.json> [--dry-run]` está listo y probado; falta que el owner lo pida. Pasos: exportar «Limpieza» a un JSON fuera del repo (formato en la cabecera de `scripts/household-import.ts`), respaldo verificado, `--dry-run` y luego el import. Productos y recetas se cargan a mano (decisión del owner).
- **Cambiar la categoría o el nombre de un producto:** hoy un producto conocido conserva su categoría y no hay forma de cambiarla desde la lista (olvidarlo y volver a añadirlo la cambia). Editar categoría y nombre en la fila.
- **Categorías y zonas editables:** las 8 categorías son fijas en código y las zonas salen de las etiquetas en uso (renombrar una zona es renombrar su etiqueta en `/tasks`).
- **Editar una limpieza desde Hogar:** hoy se edita en su página de `/tasks`; «Quitar» elimina la tarea y corta la serie. Una pausa reactivable necesitaría un estado nuevo en `tasks`.
- **Contratos de `tasks` acotados:** `completeModuleTask`, `deleteModuleTask`… aceptan cualquier id de tarea (es un solo dueño, no es un hueco); si se quiere, exigir la etiqueta `limpieza` en la acción.
- **«Receta de hoy» en Hoy** y **plan semanal / ingredientes → lista de compras:** fuera de v1 por decisión del owner.
- **Anunciar tras cerrar la hoja de «Añadir limpieza»:** el aviso se dice con la hoja abierta (la página está `aria-hidden`); `recipes-screen` ya lo hace tras cerrar, falta igualarlo.
- **«Deshacer» dos veces seguidas** puede anunciar dos veces el mismo mensaje (las acciones son idempotentes).
- **E2E y la medianoche de Lima:** `e2e/household.spec.ts` calcula el día con el reloj del proceso de prueba (`todayWeekday`); un run que cruce las 00:00 de Lima puede fallar «Para hoy» (reintentar). Lo mismo le pasó a `projects`, `task-views` y `today-projects` el 2026-10-14 a las 05:00 UTC.
- **Filas que quedaron de prueba en producción:** el Checkpoint dejó, borradas por la app (borrado lógico), una tarea `[QA] Limpiar inodoro` (y su ocurrencia), un producto `[QA] Leche` y una receta `[QA] Arroz con pollo`; no se ven y están en el respaldo.

## Módulo `goals`: cerrado el 2026-10-13

Plan y tareas archivados en [`archive/goals-plan.md`](archive/goals-plan.md) y [`archive/goals-todo.md`](archive/goals-todo.md). G1–G4 en producción (#111–#114). **Siguiente: `weekly-review`** (sin spec todavía: se arranca con `spec-driven-development`).

## Corte `polish` (benchmark rimu, decidido con el owner el 2026-10-06)

Mejoras cortas a módulos cerrados que salen de [`docs/benchmark-rimu.html`](../docs/benchmark-rimu.html) (§7 "Oportunidades", con problema, propuesta, principios y criterio de aceptación de cada una). Se hacen **antes de `reminders`**, un PR por ítem, en este orden (prioridad = impacto × frecuencia ÷ esfuerzo). Dependencias nuevas aprobadas por el owner: `motion` y `canvas-confetti`.

- [x] **`postpone-one-tap` — "Mover a mañana" desde Hoy (16, S):** (PR #86, `feat/postpone-one-tap`) acción `postponeTask(id, to)` en `tasks`; tecla "Mañana" (44 px) y menú "Otro día…" en las filas de `/` y de la vista Hoy; deslizar a la izquierda en el celular (con `motion`, solo horizontal con umbral, el botón como alternativa accesible); optimista con "Deshacer"; una recurrente mueve solo esta ocurrencia. E2E con `@today-tasks`.
- [x] **`task-time` — Hora opcional en tareas (12, S):** (`feat/task-time`; decisiones para revisar en `docs/HANDOFF.md` → "Cómo funciona polish → task-time") columna aditiva `due_time` (hora de Lima); campo en el detalle; en `/` y en Hoy las tareas con hora van primero ordenadas por hora y la muestran; sin duración ni bloques. Prerequisito de `reminders`.
- [x] **`capture-nl-dates` — Lenguaje natural al capturar (10, M): (`feat/capture-nl-dates`; decisiones para revisar en `docs/HANDOFF.md` → "Cómo funciona polish → capture-nl-dates")** función pura `src/lib/natural-date.ts` (sin IA ni dependencia): "hoy", "mañana", "pasado", días de la semana, "el 15", "15 oct", "en 3 días", "10am", "16:30"; para gastos, el primer número con coma o punto es el monto ("12.50 café", "USD 95 claude"). Vista previa en la LCD bajo el campo ("→ Vence el vie 10 · 10:00"), cancelable con un toque; lo interpretado sale del título. Mismo parser en la bandeja y, con `reminders`, en el bot de Telegram. Tabla de casos grande (día de Lima, medianoche, cambio de mes).
- [x] **`greeting-variants` — Saludo con estado (10, S):** (`feat/greeting-variants`; ver `docs/HANDOFF.md` → "Cómo funciona polish → greeting-variants") segunda línea bajo el saludo de `/` por franja (mañana / tarde / noche) y estado (nada hecho / algo / todo / vacío), 3–4 variantes por combinación con `variantForDay`; lista negra de palabras ("todavía", "solo", contadores de lo que falta) comprobada en un test.
- [x] **`habit-skip-day` — "Saltar hoy" (9, S):** (PR de `feat/habit-skip-day`; decisiones para revisar en `docs/HANDOFF.md` → "Cómo funciona polish → habit-skip-day") tecla en la hoja de opciones del pad (y, en `/`, en una hojita propia de la esquina) que crea una pausa de un día (hoy, motivo "Descanso") reutilizando `habit_pauses`; LCD "«Gimnasio» descansa hoy · Deshacer"; no aparece si el día ya está en pausa; el detalle muestra "N días saltados este mes" como dato.
- [x] **`installments` — Cuotas que terminan solas (6, S):** columna aditiva `installments_total` en `finance_recurring_payments`; "Termina después de N pagos" en la hoja (mensual); `schedule.ts` no genera períodos tras el N-ésimo; lista "Cuota 3 de 6"; al pagar la última se archiva con "Deshacer"; editar N por debajo de las pagadas se rechaza (lección de F2). Hecho en `feat/installments` (PR; decisiones para revisar en `docs/HANDOFF.md` → "Cómo funciona polish → installments").
- [x] **`evening-close-ritual` — Cierre del día cuando quedó algo (10, M):** (`feat/evening-close-ritual`; ver `docs/HANDOFF.md` → "Cómo funciona polish → evening-close-ritual") desde las **20:00** (preferencia editable) la cabecera de `/` pasa a modo cierre: primero lo logrado ("Hoy: 4 hábitos · 3 tareas · 1 pago", NumberFlow), luego una sola pregunta "Quedan 2 tareas. ¿Las pasamos a mañana?" con "Mañana" (usa `postponeTask` en lote) y "Dejar aquí"; hábitos solo como "4 de 5"; mensajes variados sin culpa. Necesita `postpone-one-tap`.
- [x] **`celebration-milestones` — Hitos con movimiento (4, S):** (`feat/celebration-milestones`; ver `docs/HANDOFF.md` → "Cómo funciona polish → celebration-milestones") `canvas-confetti` monocromo con el color del área en 30+ (≤ 800 ms, nunca con movimiento reducido); el número de racha con NumberFlow en cada toque. Cierra el ítem "Confeti en hitos de racha" del backlog.

Quedan en el backlog (abajo, sección "Del benchmark") los de menor prioridad: `ics-feed`, `task-checklist`, `habit-heatmap-year`.

## Backlog técnico

### `weekly-review` → backlog consolidado (W1–W4, cierre)

Para decidir con el owner o tomar entre módulos. Detalle y decisiones en `docs/HANDOFF.md` → «Cómo funciona weekly-review».

- [ ] **Borrar la fila de prueba de producción** (`weekly_reviews`, semana 2026-09-28, nota «[QA] prueba del Checkpoint, se puede ignorar»): la revisión no tiene borrado en v1; script de datos con respaldo previo y confirmación del owner.
- [ ] **Ver la tarjeta de invitación en un navegador real** (domingo 18:00 a lunes 23:59, Lima): el Checkpoint cayó en martes y la tarjeta se probó solo con reloj fijo en pruebas.
- [ ] **Recorrer el ritual con datos reales** (hábitos, tareas abiertas, metas y proyectos) y en el iPhone: la base de producción estaba vacía; los pasos se vieron en sus estados vacíos.
- [ ] **«Dejar» no guarda nada:** solo saca la tarea del lote mientras la pantalla está abierta (decisión autónoma de W2).
- [ ] **Tareas hechas en «Semanas anteriores»:** no se muestran (exigiría un lote nuevo en `tasks`); tampoco finanzas en la revisión (fuera de v1).
- [ ] **El objetivo semanal no se puede borrar desde la revisión** (se hace en `/goals`).
- [ ] **Registro de pruebas:** la tarjeta usa un reloj de E2E (`bo_e2e_invite`); ninguna spec lo ejercita todavía.

### `goals` → backlog consolidado (G1–G4, cierre)

Para decidir con el owner o tomar entre módulos. Detalle y decisiones en `docs/HANDOFF.md` → «Cómo funciona goals».

- [ ] **Plural en «Para llegar: ~1 días por semana»** (visto en producción en el Checkpoint): el copy de «siguiente paso» no pone singular con 1 (`goals-copy.ts`).
- [ ] **Filtro por área en `/goals`:** está en las pantallas de `SPEC-goals` y no entró en G1–G4.
- [ ] **Ritmo de una meta manual pasada al próximo periodo:** compara el total contra lo esperado del periodo nuevo (decisión autónoma de G4); medir solo con las entradas del periodo exige llevar la fecha de cada entrada al `GoalItem`.
- [ ] **Sin recorrer en producción:** la sección «Metas» de la página de un proyecto, las metas de proyecto, y el teclado/foco en el iPhone (el Checkpoint cubrió hábito y cantidad).
- [ ] **Pruebas de foco de `reminders` intermitentes en CI** (`reminders-telegram-section` el 2026-10-12 y `reminders-channel-section` el 2026-10-13, ambas `toHaveFocus` y pasan al reintentar): buscar la causa en vez de reintentar.
- [ ] **El job de unitarias no es determinista de noche:** las E2E de fechas fallan si la corrida cruza 00:00 Lima (05:00 UTC); fijar un reloj en `projects`, `today-projects` y `task-views`.

### `reminders` → backlog consolidado (R1–R5, cierre R6)

Para decidir con el owner o tomar entre módulos. El detalle de cada ítem está en la sección de su corte de `docs/HANDOFF.md` → "Cómo funciona reminders".

**Minutos de CI y frecuencia del tick (antes de volver a privado, ~2026-11-01)**
- [x] **Tick a cada 30 min y solo 06:00–23:30 Lima (2026-10-12, OK del owner):** `reminders-tick.yml` pasó de `*/15` a `0,30 11-23` y `0,30 0-4` (UTC); ~1 100 min/mes frente a ~2 900. La hora de un hábito tiene ahora precisión de 30 min; la ventana de gracia de 2 h sigue alcanzando; el cron diario de Vercel no cambia.

**Ajustes → Avisos**
- [ ] **Layout shift de la sección Telegram** (revisión de R5): la sección cambia de alto entre estados (sin configurar con su lista de problemas, enlace con pasos y «Generar otro enlace», conectado, mensajes de estado y error) y empuja «Avisos del día» bajo el dedo. Reservar alto o fijar el orden de las secciones.
- [ ] E2E y axe del estado **«bloqueado»** (403) de Ajustes.
- [ ] E2E/axe con «Guardado.» y con la alerta de error visibles en «Avisos del día»; revisar el solape de textos a 320 px (ayudas largas junto al interruptor); rollback de un guardado fallido en un navegador real (hoy solo en componente).
- [ ] Extraer los textos incrustados de `telegram-section.tsx` a `reminders-copy.ts`.
- [ ] Quitar un dispositivo de push que no sea el actual desde Ajustes (hoy un teléfono perdido solo se revoca cuando el servicio de push responde 404/410); «Enviar una prueba» para comprobar el push sin esperar al tick.

**Hábitos con hora y franja (R4)**
- [ ] **Enter en «Identidad» y «Señal»** (campos de «Más detalles» del formulario de hábito): no se probó si envían; en «Nombre» sí funciona.
- [ ] **Cambiar la hora de un hábito después de reclamar el día no re-notifica:** la clave `habit:<id>:<día>` no incluye la hora; si el aviso ya salió (o quedó `skipped` por ventana cerrada), mover la hora no vuelve a avisar ese día. Decidir con el owner si debe (clave con la hora).
- [ ] Captura de los pads agrupados por franja y del formulario con «Hora del aviso» y «Franja» abierto.
- [ ] Un hábito «a evitar» con hora (imposible por el `CHECK`) no muestra error en un campo visible: el `CHECK` es el último muro.
- [ ] Prueba de Enter con IME (composición) en «Nombre».
- [ ] Borrador de la hora al volver de «A evitar» a «A cumplir» (hoy se conserva; no se envía mientras está en «A evitar»).
- [ ] Un solo mensaje para varios hábitos a la misma hora: agruparlos en el motor (p. ej. `coversKeys`), no en la fuente.

**Avisos de la app (R2)**
- [ ] Aserción de integración de un pago de hace 61 días (borde de la ventana de pendientes de 60 días).
- [ ] Longitud máxima de los textos (Telegram 4096) y nombres con `\n` en hábitos o pagos dentro del resumen y los avisos.
- [ ] Cachear `briefingFacts` por tick cuando el canal sea «Ambos» (hoy el resumen se arma una vez por canal).
- [ ] Fila `skipped` inconsistente de pagos vencidos tras cambiar la hora del resumen (la ventana cerrada deja fila o no según cuándo se cambie).
- [ ] Documentado, sin cambio: una tarea añadida después de un resumen vacío ya reclamado no lo rehace.

**Bot (R3)**
- [ ] Probar `/hoy` con las fuentes reales registradas (hoy, con fuentes de juguete en integración).
- [ ] Comparar campos (no `updated_at`) si el owner quiere que «Deshacer» siga valiendo tras una edición sin cambios reales.
- [ ] Quitar el botón «Deshacer» del mensaje tras usarlo (`editMessageReplyMarkup`; hoy el segundo toque responde «Ya no estaba en la app»).
- [ ] `Promise.all` de dos `issueLinkCode` y de dos entregas del mismo `update_id`; cliente de Telegram con respuesta no JSON (502 HTML).

**Motor y pruebas (R1)**
- [ ] Registrar «sin configurar» una sola vez por instancia (hoy se registra en cada tick sin secreto).
- [ ] Integración extra: 403 con `both`, `build_failed` con tope de 3 y `messageId` no finito.
- [ ] Riesgo de timeout de la prueba de ESLint dentro de Vitest (`module-boundaries-rule`).
- [ ] El workflow del tick sale con `exit 0` si falta `REMINDERS_CRON_SECRET`: el paso de verificación (`gh workflow run reminders-tick.yml --ref main` → HTTP 200) está en la guía, paso 6.

Deuda y tareas técnicas que cruzan módulos. Se toman cuando haya espacio entre módulos o cuando algo las vuelva urgentes.

- [ ] **LCP con datos reales:** medir el LCP con datos reales (Vercel Speed Insights o Lighthouse con *throttling* real de DevTools) en vez del Lighthouse simulado. Si supera 2,5 s, autoalojar las fuentes recortadas (prototipo: ~0,15 s). Ver "Rendimiento de `/login` (LCP)" en `docs/HANDOFF.md` (cómo medir, hallazgos y siguientes palancas). Origen: criterio de Calidad de `SPEC-core.md`, aceptado por el owner el 2026-10-01.
- [x] **Postgres de pruebas en 18:** CI (`ci.yml`, `update-screenshots.yml` y `backup.yml` con `target=ci-service`) usa `postgres:18.6` fijado por digest, y en local Docker se reemplazó por Postgres 18 nativo (`embedded-postgres`, `pnpm db:test:start`; ver "Pruebas E2E" en `docs/HANDOFF.md`). Hecho en `chore/no-docker-test-db`.
- [ ] **Observabilidad de errores de cliente** (de C8): un error de un componente cliente no tiene `digest` ni llega al registro del servidor; hoy la página no muestra código y nadie se entera. Definir cómo reportarlos (p. ej. un endpoint propio que registre una línea sin el mensaje).
- [x] **E2E inestable** (de C8): estabilizar la E2E de C6 `e2e/areas-order.spec.ts:329` (⌘Z deshace, escritorio). Era un error real de la app: el aviso registraba Esc y ⌘Z en un `useEffect`, que corre en una tarea posterior a la que lo pinta; una tecla apretada en ese hueco (el aviso ya en pantalla) se perdía. Ahora es un `useLayoutEffect`, con una prueba unitaria que aprieta la tecla en ese hueco. Hecho en `fix/flaky-areas-order-undo`.
- [ ] **Minutos de CI y E2E lento: plan en 4 pasos** (acordado con el owner, 2026-10-08). Origen: el job `e2e` (20 min) se cortó por timeout en `main` tres veces el 2026-10-08 y el `deploy` salió igual (`!cancelled()` no ve un job `cancelled` por timeout). Los runs sanos del E2E tardan 14–19 min (mediana del job 17,3 min; casi todo es `pnpm test:e2e`, 15,8 min). El plan gratuito da 2.000 min/mes a repos privados (se agotaron en dos días el 2026-10-02) y los runners tienen 2 vCPU. Línea base y cómo leer el resumen de tiempos: `docs/HANDOFF.md`, «CI: E2E y el gate del deploy».
  - [x] **Paso 1 (`chore/ci-deploy-gate`): gate del deploy y medición.** `deploy` y `smoke` exigen `success` exacto de sus `needs`; `timeout-minutes` del E2E de 20 a 30 (colchón mientras se aplica este plan; también en `update-screenshots.yml`); reporter `json` + `scripts/e2e-timing-summary.mjs` (resumen de tiempos en el job y artefacto `playwright-results`); línea base histórica en HANDOFF.
  - [x] **Paso 2 (`chore/ci-mobile-responsive`): `@responsive`.** `mobile` corre solo los 103 tests etiquetados `@responsive` (de solo celular, con capturas o de navegación/presentación que cambian con el ancho); `desktop` sigue con los 376. Lint `tests/lint/e2e-responsive-tag.test.ts`; regla en HANDOFF («E2E: qué corre en `mobile`»). **Build compartido: descartado** (ahorraba ~0,6 min, medido en el paso 1). Pendiente: confirmar el reloj con el resumen de tiempos del primer run en `main` (objetivo: bajar de ~17 min con margen; estimación ~12 min).
  - [x] **Paso 3 (`chore/ci-affected-specs`): menos CI por PR.** Job `changes` + `scripts/e2e-affected.mjs`: PRs solo de documentación se saltan E2E e integración (el `skipped` por `if` cuenta como check cumplido; sin `paths-ignore`); PRs de código corren solo las specs afectadas (mapa `SPEC_MODULES` + cierre de imports entre módulos; cualquier código compartido, config o desconocido = suite completa); `main` y `workflow_dispatch` siempre completos. **Shards: medidos (estimación sobre un run real), no adoptados** (+15 % de minutos con 2 shards). Detalle, plan de prueba y lo no verificable sin un push real: `docs/HANDOFF.md`, «CI: qué corre en cada PR». Pendiente tras el merge: probar con un PR de solo docs y uno de un módulo.
  - [x] **Paso 4 (`chore/ci-affected-specs`): regla y presupuesto.** `scripts/e2e-timing-summary.mjs` emite `::warning::` cuando el reloj de Playwright pasa de 12 min (`E2E_BUDGET_MINUTES`; nunca falla el job) y el resumen muestra el presupuesto; la regla «máximo un spec E2E nuevo por corte» está en `CLAUDE.md` y en HANDOFF.
- [x] **Pruebas unitarias intermitentes:** `project-dependencies` y `project-detail` comprobaban la vuelta atrás optimista justo después del aviso (que puede llegar antes); ahora esperan con `waitFor`. Hecho en `fix/flaky-rollback-tests`.
- [ ] **Hitos en proyectos cerrados** (del Checkpoint final de `tasks`): en un proyecto Terminado o Cancelado la sección Tareas no deja agregar, pero Hitos sí deja crear y reordenar. Decidir con el owner si se bloquea también.
- [ ] **"Archivados" más liviano** (de H5): la sección en "Semana" lee cada hábito archivado como `HabitItem` (con todos sus registros marcados para las rachas) aunque solo muestra nombre, área y "Reactivar". Con muchos archivados, una consulta propia (id, nombre, área).
- [ ] **Navegación definitiva de Tareas** (T6): espera el diseño del owner en Claude Design; hoy es provisional (atajo 3, barra inferior después de la tecla de captura).
- [ ] **Navegación definitiva de Hábitos** (H6): espera el diseño del owner en Claude Design, como la de Tareas; hoy es la provisional de H1 (atajo 4, la celda después de la tecla de captura en la barra inferior, Tareas en "Más").
- [ ] **Archivados de hábitos** (de H5): la lista lee cada hábito archivado completo, con su historial; si crecen, una consulta más liviana.
- [ ] **`DayCell` en Claude Design** (de H5): los estados "pasado sin cumplir", "parcial" y "no cuenta" del calendario de hábitos viven en `overrides.css` (`PENDING UPSTREAM`); aplicarlos en Claude Design y vaciar el override.
- [ ] **Calendario de hábitos a 320 px** (de H5): cada día mide ~39 px (cumple WCAG AA, no los 44 px del principio 14). Revisarlo con el diseño.
- [ ] **Hook único de pads de hábitos** (de D1): que `habits` exporte `useHabitPadsLog` (o un componente cliente que dibuje la grilla de pads con su registro) y `today` deje de importar `habit-list-optimistic`, `habits-copy` y `useHabitsScreen`, como `tasks` hizo en D2 con `taskCompletion` y `TaskTodayRow`.
- [ ] **Áreas y la portada** (de D2): renombrar, cambiar el color o archivar un área (`core`) no revalida `/`; las tareas (y los hábitos) de la portada muestran el área vieja hasta la siguiente lectura. `core` no puede importar a `today`: que `core` revalide `/` directamente al cambiar un área.
- [x] **Confeti en hitos de racha** (de H4): hecho en `celebration-milestones` (corte `polish`).
- [ ] **Clic perdido tras eliminar** (del Checkpoint final de `today`, 2026-10-03): justo después de eliminar una tarea o un hábito (aviso con "Deshacer" en pantalla), el primer clic en la página no hace nada y el segundo sí. Pasa en Tareas y en Hábitos, y también tras cerrar la hoja de captura en Finanzas (visto el 2026-10-05). Reproducir con una E2E y corregir (¿foco o capa del visor de avisos?).
- [ ] **Grilla de hábitos que salta en el iPhone** (de D4): al cumplirse un hábito de cantidad su tarjeta crece y "Día completo" aparece arriba y empuja la grilla bajo el dedo. Si molesta en el uso diario: reservar alto o no empujar en vivo (opciones en HANDOFF → D4).
- [ ] **E2E intermitente "Hito"** (`e2e/task-views.spec.ts`, escritorio; visto en local durante D4): tras elegir "Sin hito", `milestoneId` no vuelve a `null` en 5 s en corridas conjuntas. Estabilizar.
- [ ] **Datos de demo que envejecen:** las fechas se calculan el día en que se cargan (2026-10-03). Para refrescarlas: `pnpm db:demo:remove` y `pnpm db:demo` (ver HANDOFF → "Datos de demo"). Quitarlos antes de usar la app con datos reales.
- [ ] **Texto perdido al cambiar "Tarea · Gasto"** (de F1): cambiar de tipo en la hoja de captura monta la otra hoja y se pierde lo ya escrito. Conservarlo (o no desmontar la hoja).
- [ ] **`Key` con `aria-disabled` en Claude Design** (de F4): el estilo de una tecla en espera vive en `overrides.css` (`PENDING UPSTREAM`); aplicarlo en Claude Design y vaciar el override.
- [ ] **Moneda de los recurrentes importados** (de F5): ChatGPT, DevTalles y Claude se pagan con un medio en USD pero entraron en PEN; el owner los corrige en la app si son en dólares.
- [ ] **Flakes vistos durante `finance`:** `e2e/habits.spec.ts:97` (timeout de 30 s una vez en CI, PR #79) y `tests/app/project-notes-links.test.tsx` ("a refused reorder goes back", falló una vez en la suite completa). Vigilar; estabilizar si se repiten.

### Del benchmark rimu (2026-10-06, menor prioridad; detalle en `docs/benchmark-rimu.html` §7)

- [ ] **`ics-feed` — Calendario ICS de solo lectura (6, S):** ruta `/calendar/<token>.ics` con token revocable desde Ajustes; tareas con fecha, vencimientos de proyectos y pagos pendientes como eventos de día completo; **sin montos** (decisión del owner, 2026-10-06), solo nombre y fecha; se suscribe desde Calendario de iOS.
- [ ] **`task-checklist` — Checklist dentro de la tarea (4,5, M):** las listas `- [ ]` de las notas Markdown de la tarea se vuelven interactivas en el detalle (toggle por índice, rechazado si el texto cambió) y la fila en Hoy muestra "2 de 6". El renderizador de `src/lib/markdown/` gana casillas que `projects` y `notes` reutilizan.
- [ ] **`habit-heatmap-year` — Vista anual por hábito (3, M):** 26 semanas de `DayCell` pequeñas bajo el calendario del detalle, con "Llevas 118 días hechos desde abril"; `role="img"` con resumen; sin porcentajes ni vista de todos los hábitos a la vez.
- [ ] **`budget-caps` — Tope mensual por categoría (4,5, M):** era el módulo `budget`; reducido a una columna aditiva `monthly_cap_cents` en `finance_categories` y una marca en la barra del resumen ("S/ 600 de S/ 670"; pasado el tope, color de señal, nunca rojo). Se toma como corte de `finance` cuando haya espacio.
- **Descartados con el owner (2026-10-06):** tarjetas con cierre y vencimiento (paga mixto y no necesita separar la factura), importación de extractos CSV (se apuesta a la captura rápida; se retoma si en dos meses los gastos sueltos no se sostienen), tipo de cambio automático, ingresos/patrimonio, PDF, Google Calendar bidireccional, Kanban/Eisenhower/Gantt, grafo de notas.
- [ ] **E2E que cruza la medianoche de Lima** (2026-10-07): el run de `main` del merge de `installments` falló en `e2e/projects.spec.ts:61` ("Vence hoy") y en la captura de proyectos oscuros a las 00:01 hora de Lima; el run siguiente pasó. Fijar el reloj en esos specs (o evitar fechas relativas a "hoy" cerca de la medianoche) si se repite.
- [x] **CI más barato antes de volver a privado (~2026-11-01):** hecho con los pasos 3 y 4 del plan de «Minutos de CI y E2E lento» (specs afectados en PR, docs sin E2E ni integración, presupuesto). Queda aparte el tick de 15 min de `reminders` (arriba). Ver también la regla del gate local liviano en `CLAUDE.md`.
