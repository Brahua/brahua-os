# Tareas

> En curso: el módulo **`reminders`** (spec aprobada v1.1, 2026-10-08; plan en [`plan.md`](plan.md)). El corte `polish` quedó completo. Planes y tareas de módulos cerrados en [`archive/`](archive/).

## Módulo `reminders` (spec: [`SPEC-reminders.md`](../SPEC-reminders.md), plan: [`plan.md`](plan.md))

Un implementador a la vez. Verificación local = gate liviano; lo demás lo valida el CI.

### R1 — Cimientos

Hecho en `feat/reminders-r1` (detalle, decisiones autónomas y puntos de extensión en `docs/HANDOFF.md` → "Cómo funciona reminders → R1"). `vercel deploy --dry` no se corrió (orden del corte).

- [x] **R1.1 Datos y contrato:** migración `0013_reminders.sql` (`reminder_settings` de fila única con `CHECK`, `telegram_link_codes`, `reminder_deliveries` con único `(dedupe_key, channel)`, `telegram_updates`, `telegram_captures`, `push_subscriptions`; `habits.reminder_time` y `daypart` se dejan para R4), exportación (sin `telegram_link_codes` ni `push_subscriptions`), `contracts.ts` (`registerReminderSource`, `ReminderChannel`), `slots.ts` puro.
  - Aceptación: `CHECK` rechaza una segunda fila de settings; `slots.ts` calcula instantes y ventana de 2 h en Lima (23:59, medianoche).
  - Verificar: unitarias de `slots.ts`; prettier de `drizzle/meta/*_snapshot.json`. Archivos: `reminders/db/schema.ts`, `drizzle/0013…`, `contracts.ts`, `slots.ts`, `core/export.ts`.
- [x] **R1.2 Telegram y vinculación:** `TelegramClient` (`sendMessage`, `answerCallbackQuery`, `setWebhook`, base configurable), servidor falso para pruebas, código de un solo uso (hash, 10 min, tope de 5 fallos), acciones «Conectar» (registra el webhook) y «Desconectar».
  - Aceptación: código caducado, reutilizado o inválido se rechaza; el token no aparece en logs.
  - Verificar: unitarias del código y del cliente con el servidor falso. Archivos: `reminders/channels/telegram/*`, `reminders/actions.ts`.
- [x] **R1.3 Motor y endpoint `tick`:** `engine.ts` (reclamar `dedupe_key`, ventana de gracia, reintentos ≤ 3, 403 desconecta), `POST /api/reminders/tick` con Bearer en tiempo constante (404 si no), `reminder-sources.ts`, `.github/workflows/reminders-tick.yml` (`*/15`, SHA fijados) y cron diario de Vercel en `vercel.json`.
  - Aceptación: dos ticks a la vez → una entrega (con control positivo); fuera de ventana → `skipped`.
  - Verificar: integración (CI) + unitarias del motor con reloj fijo; `vercel deploy --dry` por haber tocado `vercel.json`. Archivos: `engine.ts`, `route.ts`, workflow, `vercel.json`, raíz de composición.
- [x] **R1.4 Ajustes → Avisos (esqueleto):** `/settings/reminders` con estado de Telegram, Conectar/Desconectar, slots para R2 (interruptores y horas) y R5 (push y selector de canal), `aria-disabled` mientras guarda, regla ESLint de límites de importación.
  - Aceptación: axe en 0 en ambos temas y 320 px; foco restaurado tras conectar.
  - Verificar: componente + E2E con el servidor falso (CI). Archivos: página, componentes, `eslint.config.mjs`.

### R2 — Avisos de la app

Hecho en `feat/reminders-r2` (detalle, claves de deduplicación, decisiones autónomas y puntos de extensión en `docs/HANDOFF.md` → "Cómo funciona reminders → R2").

- [x] **R2.1 Fuentes de `finance` y `tasks`:** `getUpcomingPayments(from, to)`, fuente de pagos (víspera, +3 días) y fuente de resumen de hoy (tareas y pagos) usando el resumen de `tasks` (`selectTasksTodaySummary`: el tick no tiene sesión).
  - Aceptación: un pago pagado u omitido no avisa; con `show_amounts` apagado el texto no lleva monto.
  - Verificar: unitarias + integración (CI). Archivos: `finance/contracts.ts`, `finance/reminders-source.ts`, `tasks/reminders-source.ts`, raíz.
- [x] **R2.2 Fuente de `habits`, briefing y repaso:** hábitos de hoy no hechos ni pausados; `briefing` (≤ 3 líneas, vacío → `skipped`) y `evening_review` («Te queda Leer. Si lo haces ahora, cuenta hoy.»).
  - Aceptación: lista de cadenas prohibidas en cero; sin hábitos pendientes no hay repaso.
  - Verificar: unitarias de `messages.ts` + integración (CI). Archivos: `habits/reminders-source.ts`, `messages.ts`, raíz.
- [x] **R2.3 Ajustes de avisos:** interruptores y horas (briefing, repaso), interruptor de montos, validación Zod, guardado con aviso.
  - Aceptación: cambiar la hora mueve el aviso de hoy si aún no pasó.
  - Verificar: componente + E2E (CI). Archivos: acciones, formulario, copy.

### R4 — Hábitos con hora y franja

Hecho en `feat/reminders-r4` (detalle, decisiones autónomas y puntos de extensión en `docs/HANDOFF.md` → "Cómo funciona reminders → R4"). E2E: un solo spec nuevo (`e2e/habits-dayparts.spec.ts`), sin captura nueva.

- [x] **R4.1 Datos y formulario:** migración aditiva `habits.reminder_time` y `daypart` (`CHECK` sin hábitos «a evitar»), campos «Hora del aviso» y «Franja» al crear/editar.
  - Aceptación: Zod y `CHECK` rechazan hora en un hábito a evitar; sin valores todo queda como hoy.
  - Verificar: unitarias + integración (CI). Archivos: migración, `habits/db/schema.ts`, formulario, constantes.
- [x] **R4.2 Aviso `habit_time` y pads por franja:** aviso a su hora (no si está hecho o pausado) y pads de Hoy agrupados por franja con «Sin franja» al final.
  - Aceptación: sin franjas, `/` queda idéntica; `@today-*` en las E2E.
  - Verificar: componente + E2E con captura (CI). Archivos: fuente, pads, `today`.

### R3 — Captura por texto

Hecho en `feat/reminders-r3` (detalle, decisiones autónomas y qué revisar en seguridad en `docs/HANDOFF.md` → "Cómo funciona reminders → R3"). Sin migración ni E2E nuevo.

- [x] **R3.1 Webhook:** `POST /api/telegram/webhook` (secreto, tamaño, `update_id`, un solo chat, `/start <código>`), `/ayuda`.
  - Aceptación: sin secreto 401; chat ajeno no guarda nada; `update_id` repetido una sola vez.
  - Verificar: integración con el servidor falso (CI). Archivos: `route.ts`, `webhook.ts`.
- [x] **R3.2 Clasificar y crear:** `bot-capture.ts` (raíz) con `parseTaskText`/`parseExpenseText`, `/tarea`, `/gasto`, `/hoy`; lo no entendido a la bandeja; respuesta con resumen y «Deshacer» sobre `telegram_captures`.
  - Aceptación: «pilas mañana» → tarea con fecha; «12.50 café» → gasto; «café 12» → tarea; «Deshacer» exacto, sin pisar ediciones.
  - Verificar: tabla de casos unitaria + integración (CI). Archivos: `bot-capture.ts`, `classify.ts`, `undo.ts`.

### R5 — Push web

- [ ] **R5.1 Canal y servicio:** dependencia `web-push`, `webPushChannel`, `push_subscriptions` (alta/baja, 404/410 revoca), `pnpm reminders:vapid` (imprime solo la pública), `public/sw.js` (solo `push` y `notificationclick`) con cabecera `no-cache`.
  - Aceptación: una entrega por canal; un canal que falla no bloquea al otro; sin `fetch` en el service worker (test que lo lee).
  - Verificar: unitarias + integración con servidor de push local (CI). Archivos: `channels/web-push.ts`, `sw.js`, script, `next.config` (build en CI por tocarlo).
- [ ] **R5.2 Ajustes de push y selector:** «Activar en este dispositivo» (gesto, permiso, `subscribe`), explicación de instalación si no hay soporte, «Canal de avisos» (Push por defecto, respaldo a Telegram), montos de push apagados por defecto.
  - Aceptación: sin dispositivo suscrito los avisos salen por Telegram si está conectado; Ajustes lo indica.
  - Verificar: componente con `PushManager` simulado + E2E (CI). Archivos: formulario, acciones, copy.

### R6 — Cierre

- [ ] **R6.1 Puesta en marcha y documentación:** guía para el owner (BotFather, variables, `gh secret set`), HANDOFF («Cómo funciona reminders», decisiones autónomas), `SPEC-reminders.md` con las decisiones finales, backlog («Minutos de CI» con el tick de 15 min).
- [ ] **R6.2 Checkpoint final:** recorrido en producción con el Chrome del owner y pruebas reales en el iPhone (Telegram y push); retrospectiva con reglas nuevas en `CLAUDE.md`.

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

### `reminders` R3 → pendientes
- Probar `/hoy` con las fuentes reales registradas (hoy se prueba con fuentes de juguete en integración).
- Comparar campos (no `updated_at`) si el owner quiere que «Deshacer» siga valiendo tras una edición sin cambios reales.
- Quitar el botón «Deshacer» del mensaje tras usarlo (`editMessageReplyMarkup`; hoy el segundo toque responde «Ya no estaba en la app»).

### `reminders` R4 → pendientes de la revisión del PR #98
- Captura de los pads agrupados por franja y del formulario con «Hora del aviso» y «Franja» abierto.
- Un hábito «a evitar» con hora (imposible por el `CHECK`) no muestra error en un campo visible: el `CHECK` es el último muro.
- Prueba de Enter con IME (composición) en «Nombre».
- Decidir qué pasa con el borrador de la hora al volver de «A evitar» a «A cumplir» (hoy se conserva; no se envía mientras está en «A evitar»).
- Si el owner prefiere un solo mensaje para varios hábitos a la misma hora: agruparlos en el motor (p. ej. `coversKeys`), no en la fuente.

### `reminders` R2 → pendientes de la revisión del PR #96
- E2E/axe con «Guardado.» y con la alerta de error visibles en la sección «Avisos del día».
- Revisar el solape de textos de «Avisos del día» a 320 px (ayudas largas junto al interruptor).
- Rollback de un guardado fallido probado en un navegador real (hoy solo en componente).
- Aserción de integración de un pago de hace 61 días (borde de la ventana de pendientes de 60 días) con la fuente de pagos.
- Longitud máxima de los textos (Telegram 4096) y nombres con `\n` en hábitos o pagos dentro del resumen y los avisos.
- Documentado, sin cambio: una tarea añadida después de un resumen vacío ya reclamado no lo rehace.
- Cachear `briefingFacts` por tick cuando el canal sea «Ambos» (R5).
- Fila `skipped` inconsistente de pagos vencidos tras cambiar la hora del resumen (la ventana cerrada deja fila o no según cuándo se cambie).

Deuda y tareas técnicas que cruzan módulos. Se toman cuando haya espacio entre módulos o cuando algo las vuelva urgentes.

- [ ] **LCP con datos reales:** medir el LCP con datos reales (Vercel Speed Insights o Lighthouse con *throttling* real de DevTools) en vez del Lighthouse simulado. Si supera 2,5 s, autoalojar las fuentes recortadas (prototipo: ~0,15 s). Ver "Rendimiento de `/login` (LCP)" en `docs/HANDOFF.md` (cómo medir, hallazgos y siguientes palancas). Origen: criterio de Calidad de `SPEC-core.md`, aceptado por el owner el 2026-10-01.
- [x] **Postgres de pruebas en 18:** CI (`ci.yml`, `update-screenshots.yml` y `backup.yml` con `target=ci-service`) usa `postgres:18.6` fijado por digest, y en local Docker se reemplazó por Postgres 18 nativo (`embedded-postgres`, `pnpm db:test:start`; ver "Pruebas E2E" en `docs/HANDOFF.md`). Hecho en `chore/no-docker-test-db`.
- [ ] **Observabilidad de errores de cliente** (de C8): un error de un componente cliente no tiene `digest` ni llega al registro del servidor; hoy la página no muestra código y nadie se entera. Definir cómo reportarlos (p. ej. un endpoint propio que registre una línea sin el mensaje).
- [x] **E2E inestable** (de C8): estabilizar la E2E de C6 `e2e/areas-order.spec.ts:329` (⌘Z deshace, escritorio). Era un error real de la app: el aviso registraba Esc y ⌘Z en un `useEffect`, que corre en una tarea posterior a la que lo pinta; una tecla apretada en ese hueco (el aviso ya en pantalla) se perdía. Ahora es un `useLayoutEffect`, con una prueba unitaria que aprieta la tecla en ese hueco. Hecho en `fix/flaky-areas-order-undo`.
- [ ] **Minutos de CI y E2E lento: plan en 4 pasos** (acordado con el owner, 2026-10-08). Origen: el job `e2e` (20 min) se cortó por timeout en `main` tres veces el 2026-10-08 y el `deploy` salió igual (`!cancelled()` no ve un job `cancelled` por timeout). Los runs sanos del E2E tardan 14–19 min (mediana del job 17,3 min; casi todo es `pnpm test:e2e`, 15,8 min). El plan gratuito da 2.000 min/mes a repos privados (se agotaron en dos días el 2026-10-02) y los runners tienen 2 vCPU. Línea base y cómo leer el resumen de tiempos: `docs/HANDOFF.md`, «CI: E2E y el gate del deploy».
  - [x] **Paso 1 (`chore/ci-deploy-gate`): gate del deploy y medición.** `deploy` y `smoke` exigen `success` exacto de sus `needs`; `timeout-minutes` del E2E de 20 a 30 (colchón mientras se aplica este plan; también en `update-screenshots.yml`); reporter `json` + `scripts/e2e-timing-summary.mjs` (resumen de tiempos en el job y artefacto `playwright-results`); línea base histórica en HANDOFF.
  - [x] **Paso 2 (`chore/ci-mobile-responsive`): `@responsive`.** `mobile` corre solo los 103 tests etiquetados `@responsive` (de solo celular, con capturas o de navegación/presentación que cambian con el ancho); `desktop` sigue con los 376. Lint `tests/lint/e2e-responsive-tag.test.ts`; regla en HANDOFF («E2E: qué corre en `mobile`»). **Build compartido: descartado** (ahorraba ~0,6 min, medido en el paso 1). Pendiente: confirmar el reloj con el resumen de tiempos del primer run en `main` (objetivo: bajar de ~17 min con margen; estimación ~12 min).
  - [ ] **Paso 3: shards y/o specs afectados en PR, antes de volver a privado (~2026-11-01).** `--shard=i/N` en una matriz del job `e2e` (cada shard paga instalación y build; medirlo) y/o, en PRs, solo los specs afectados con la suite completa en `main`. **Aviso:** `--only-changed` de Playwright solo mira archivos de test (y lo que ellos importan), no el código de la app: un cambio en `src/` no dispara ningún spec; hace falta un mapa módulo → specs (o correr todo cuando cambie `src/`). Más `paths-ignore` para PRs solo de docs y no lanzar el CI por cada push de un agente (push una vez, con el gate local en verde), menos capturas.
  - [ ] **Paso 4: regla «máximo un spec E2E por corte» y presupuesto de tiempo.** Cada corte (módulo/slice) añade como mucho un spec E2E nuevo (el resto, unitarias/componente/integración); presupuesto del job E2E de ~12 min con alerta (por implementar: p. ej. un `::warning::` en `scripts/e2e-timing-summary.mjs` cuando el reloj lo pase; el paso 1 ya deja la cifra visible en cada run).
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
- [x] **`reminders` R1 → pendientes** (revisión del PR #95): purga de `telegram_updates` (hecho en R3, `retention.ts`).
- [ ] **`reminders`:** registrar «sin configurar» una vez por instancia (hoy, en cada tick sin secreto).
- [ ] **`reminders`:** E2E del estado «bloqueado» de Ajustes y axe en él.
- [ ] **`reminders`:** integración extra: 403 con `both`, `build_failed` con tope de 3 y `messageId` no finito.
- [ ] **`reminders`:** pruebas con `Promise.all` de dos `issueLinkCode` y de dos entregas del mismo `update_id`.
- [ ] **`reminders`:** cliente de Telegram con respuesta no JSON (502 HTML).
- [ ] **`reminders`:** extraer los textos de `telegram-section.tsx` a `reminders-copy.ts`.
- [ ] **`reminders`:** riesgo de timeout de la prueba de ESLint dentro de Vitest (`module-boundaries-rule`).
- [ ] **`reminders`:** el workflow del tick sale con `exit 0` si falta `REMINDERS_CRON_SECRET`: paso de verificación para el owner al poner las variables (`gh workflow run reminders-tick.yml --ref main` → HTTP 200).
- [ ] **Flakes vistos durante `finance`:** `e2e/habits.spec.ts:97` (timeout de 30 s una vez en CI, PR #79) y `tests/app/project-notes-links.test.tsx` ("a refused reorder goes back", falló una vez en la suite completa). Vigilar; estabilizar si se repiten.

### Del benchmark rimu (2026-10-06, menor prioridad; detalle en `docs/benchmark-rimu.html` §7)

- [ ] **`ics-feed` — Calendario ICS de solo lectura (6, S):** ruta `/calendar/<token>.ics` con token revocable desde Ajustes; tareas con fecha, vencimientos de proyectos y pagos pendientes como eventos de día completo; **sin montos** (decisión del owner, 2026-10-06), solo nombre y fecha; se suscribe desde Calendario de iOS.
- [ ] **`task-checklist` — Checklist dentro de la tarea (4,5, M):** las listas `- [ ]` de las notas Markdown de la tarea se vuelven interactivas en el detalle (toggle por índice, rechazado si el texto cambió) y la fila en Hoy muestra "2 de 6". El renderizador de `src/lib/markdown/` gana casillas que `projects` y `notes` reutilizan.
- [ ] **`habit-heatmap-year` — Vista anual por hábito (3, M):** 26 semanas de `DayCell` pequeñas bajo el calendario del detalle, con "Llevas 118 días hechos desde abril"; `role="img"` con resumen; sin porcentajes ni vista de todos los hábitos a la vez.
- [ ] **`budget-caps` — Tope mensual por categoría (4,5, M):** era el módulo `budget`; reducido a una columna aditiva `monthly_cap_cents` en `finance_categories` y una marca en la barra del resumen ("S/ 600 de S/ 670"; pasado el tope, color de señal, nunca rojo). Se toma como corte de `finance` cuando haya espacio.
- **Descartados con el owner (2026-10-06):** tarjetas con cierre y vencimiento (paga mixto y no necesita separar la factura), importación de extractos CSV (se apuesta a la captura rápida; se retoma si en dos meses los gastos sueltos no se sostienen), tipo de cambio automático, ingresos/patrimonio, PDF, Google Calendar bidireccional, Kanban/Eisenhower/Gantt, grafo de notas.
- [ ] **E2E que cruza la medianoche de Lima** (2026-10-07): el run de `main` del merge de `installments` falló en `e2e/projects.spec.ts:61` ("Vence hoy") y en la captura de proyectos oscuros a las 00:01 hora de Lima; el run siguiente pasó. Fijar el reloj en esos specs (o evitar fechas relativas a "hoy" cerca de la medianoche) si se repite.
- [ ] **CI más barato antes de volver a privado (~2026-11-01):** absorbido por el plan en 4 pasos de «Minutos de CI y E2E lento» (paso 3: shards, specs afectados en PR con la salvedad de `--only-changed`, `paths-ignore` para docs). Ver también la regla del gate local liviano en `CLAUDE.md`.
