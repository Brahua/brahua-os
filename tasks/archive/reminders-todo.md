# Tareas: reminders

> Plan: [`reminders-plan.md`](reminders-plan.md) · Spec: [`SPEC-reminders.md`](../../SPEC-reminders.md)
> Módulo **cerrado por el owner el 2026-10-12** (R1–R6 integrados y en producción). El Checkpoint final se recorrió así: la parte A la hizo el agente en producción con Claude in Chrome; en la parte B el owner probó el push en el iPhone y la captura por Telegram.
> **Sin comprobar en producción** (los cubre CI o quedan como seguimiento): 320 px sin scroll lateral y axe en ambos temas (E2E de CI); hábito «a evitar» sin hora (E2E de R4); «Quitar hora»; «Deshacer» sobre una captura editada en la app; foto o nota de voz al bot; canal «Ambos» con una notificación real; «Montos en push» encendido.
> Tareas anteriores en este mismo directorio.

## Módulo `reminders` (spec: [`SPEC-reminders.md`](../../SPEC-reminders.md), plan: [`plan.md`](reminders-plan.md))

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

- [x] **R5.1 Canal y servicio:** dependencia `web-push`, `webPushChannel`, `push_subscriptions` (alta/baja, 404/410 revoca), `pnpm reminders:vapid` (solo en la terminal del owner), `public/sw.js` (solo `push` y `notificationclick`) con cabecera `no-cache`. Hecho en `feat/reminders-r5` (detalle en HANDOFF → "R5 — Push web").
  - Aceptación: una entrega por canal; un canal que falla no bloquea al otro; sin `fetch` en el service worker (test que lo lee).
  - Verificar: unitarias + integración con servidor de push local (CI). Archivos: `channels/web-push.ts`, `sw.js`, script, `next.config` (build en CI por tocarlo).
- [x] **R5.2 Ajustes de push y selector:** «Activar este dispositivo» (gesto, permiso, `subscribe`), explicación de instalación si no hay soporte, «Canal de avisos» (Push por defecto, respaldo a Telegram), montos de push apagados por defecto.
  - Aceptación: sin dispositivo suscrito los avisos salen por Telegram si está conectado; Ajustes lo indica.
  - Verificar: componente con `PushManager` simulado + E2E (CI). Archivos: formulario, acciones, copy.

### R6 — Cierre

Hecho en `docs/reminders-r6` (solo documentación; sin funcionalidad nueva). Estado consolidado, decisiones autónomas por corte y pendientes del owner en `docs/HANDOFF.md` → "Cómo funciona reminders → R6".

- [x] **R6.1 Puesta en marcha y documentación:** guía para el owner [`docs/reminders-setup.md`](../docs/reminders-setup.md) (BotFather, las 8 variables, `vercel env add` / `gh secret set` sin pegar secretos en la sesión, `setWebhook`, redeploy, vincular, push en el iPhone, verificación del tick y de los logs, resolución de problemas); HANDOFF al día con las decisiones autónomas de R1–R5 consolidadas; backlog consolidado (abajo); `SPEC-reminders.md` ya recoge las decisiones finales de R1–R5.
- [x] **R6.2a Retrospectiva:** `CLAUDE.md` → "Lessons from `reminders`".
- [x] **R6.2b Checkpoint final** (lo hace el agente en producción con Claude in Chrome en el perfil personal del owner, más lo que solo puede el owner en el iPhone). **Prerrequisito del owner:** variables puestas, redeploy hecho y Telegram conectado (guía, pasos 1–7). Todos los datos de prueba llevan el prefijo `[QA]` y se borran al terminar (y se restauran tema, tamaño de ventana y barra lateral).

  **A. Lo recorre el agente en producción (Chrome del owner):**
  - [ ] Ajustes → Avisos carga sin «faltan variables» y sin errores de consola; el estado de Telegram dice «Conectado desde el …»; tema claro y oscuro, y a 320 px sin scroll lateral (redimensionando la ventana).
  - [ ] «Canal de avisos»: Push · Telegram · Ambos se guardan y sobreviven a recargar; la frase de abajo dice qué va a pasar (con el respaldo a Telegram si no hay dispositivo con push). Restaurar el canal original al terminar.
  - [ ] «Avisos del día»: apagar y encender «Resumen de la mañana», «Avisos de pagos», «Repaso de la noche», «Hábitos a su hora», «Montos en Telegram» y «Montos en push» (queda apagado por defecto); mover una hora (7:30 → 7:45) y restaurarla; «Guardado.» y foco correctos; una hora a medio escribir no guarda.
  - [ ] Hábito `[QA] aviso`: crear con «Hora del aviso» y «Franja»; en `/` y en Hábitos → Hoy los pads se agrupan por franja y, sin franjas, la pantalla queda como antes; «Quitar hora»; un hábito «a evitar» no ofrece la hora. Borrar el hábito.
  - [ ] Tarea `[QA]` y pago `[QA]` (recurrente de prueba) que den contenido al resumen: ver que `/hoy` en el bot (lo manda el owner) y el resumen coinciden con la portada. Borrar ambos.
  - [ ] `/sw.js` responde 200 con `Cache-Control: no-cache` y sin `fetch` en el cuerpo; `/api/reminders/tick` sin secreto responde 404 (nada que delate la ruta); `POST /api/telegram/webhook` sin cabecera de secreto responde 401.
  - [ ] Tick manual (`gh workflow run reminders-tick.yml --ref main`): el run termina con `HTTP 200` y conteos; el log de Vercel trae `reminders_tick` sin textos, montos ni ids.
  - [ ] Estados «bloqueado» y «sin canal»: solo lectura (se cubren con pruebas; no se provocan en producción).
  - [ ] Axe en 0 en Ajustes → Avisos (ambos temas) y sin scroll lateral a 320 px.
  - [ ] Limpieza: ningún dato `[QA]` queda; tema, ventana y barra lateral restaurados.

  **B. Solo el owner, en el iPhone (no se puede probar en Playwright ni en Chrome de escritorio):**
  - [ ] Instalar la PWA (Compartir → «Añadir a pantalla de inicio»; mejor borrar el ícono viejo y volver a añadirla) y abrirla desde el ícono.
  - [ ] Ajustes → Avisos → **Activar este dispositivo**: aparece el permiso de notificaciones, se acepta y el dispositivo sale en «Dispositivos con push» («iPhone · Safari»).
  - [ ] **Aviso real recibido** como notificación («brahua-os» + el texto) con el teléfono bloqueado; al tocarla abre la app en `/`. Forma de provocarlo: un hábito `[QA]` con «Hora del aviso» unos minutos antes de ahora y `gh workflow run reminders-tick.yml --ref main` (o esperar el siguiente tick de 15 min).
  - [ ] Los montos **no** salen en la notificación por defecto; encender «Montos en push» los muestra (y se vuelve a apagar).
  - [ ] **Captura por Telegram:** escribir «pilas mañana» → «Anotado: pilas · <día>» con «Deshacer»; en la app aparece la tarea con su fecha. «12.50 café» → «Gasto: S/ 12.50 · café». «café 12» → tarea. «ideas para el viaje» → «A la bandeja: …». Prefijar con `[QA]`.
  - [ ] **Deshacer:** tocar «Deshacer» en una captura recién hecha → «Deshecho.» y desaparece de la app; en otra captura, editarla en la app y luego «Deshacer» → «Ya lo cambiaste en la app, así que no lo toqué.»; un segundo toque → «Ya no estaba en la app.»
  - [ ] `/ayuda`, `/hoy` (resumen en una línea o «Hoy no tienes nada pendiente.»), `/tarea` y `/gasto` sin texto explican cómo usarlos; una foto o nota de voz responde «Por ahora solo leo texto».
  - [ ] Otra cuenta de Telegram que escriba al bot no recibe respuesta (opcional, si el owner tiene otra).
  - [ ] Canal «Ambos»: llega por push **y** por Telegram, una vez cada uno.
  - [ ] Borrar las tareas y gastos `[QA]` (desde la app) y dejar el canal elegido por el owner.

  **Cierre:** con el visto bueno del owner, archivar plan y tareas en `tasks/archive/reminders-*.md`, marcar `reminders` como cerrado en HANDOFF (estado y "Siguiente") y apuntar el siguiente módulo (`goals`).
