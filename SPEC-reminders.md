# Spec: reminders

> Módulo `reminders` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core` · `tasks`, `habits` y `finance` le aportan fuentes de avisos · Estado: **APROBADO v1.1** (2026-10-08, con push web).

## Objetivo

Que brahua-os **me hable en vez de esperar a que lo abra**: avisos por **push web** (PWA instalada) y por **Telegram**, y un bot donde capturar por texto sin abrir la app.

- **Avisos (v1, los cuatro que decidió el owner el 2026-10-06):** briefing de la mañana, pago que vence mañana, repaso de la noche y hábito a su hora. Cada uno se apaga y se reprograma en Ajustes.
- **Captura por texto:** escribirle al bot «pilas mañana» crea una tarea; «12.50 café» crea un gasto. Con el mismo parser de `capture-nl-dates` y con «Deshacer». Lo que no entiende va a la bandeja: nunca se pierde.
- **Motor genérico con canales:** los módulos registran _fuentes_ de avisos; `reminders` decide cuándo, deduplica y envía por el canal elegido (push web, Telegram o ambos). Un canal nuevo no cambia las fuentes.

Fuera de este módulo: email, WhatsApp (descartado), audio → texto (fase 2, con OK del owner), avisos de tarea a su hora (el contrato existe, ver «Preguntas abiertas»), feed ICS, varios usuarios o varios chats, que `today` muestre avisos pendientes.

### Historias de usuario

1. A las 7:30 me llega: «Buen día. Hoy: 3 hábitos, 2 tareas y 1 pago (Netflix · S/ 50).» con el enlace a `/`. Un día vacío no manda nada.
2. La víspera de un pago: «Mañana vence Netflix · S/ 50.» Si a los 3 días sigue pendiente llega un único aviso más: «Netflix sigue pendiente desde el lun 5 oct.» Nunca «atrasado».
3. A las 21:00, solo si me falta algún hábito de hoy: «Te queda Leer. Si lo haces ahora, cuenta hoy.»
4. «Leer» tiene hora 22:00: a esa hora llega «Es hora de Leer.» salvo que ya esté hecho hoy.
5. Voy en la calle y escribo al bot «pilas mañana»: responde «Anotado: pilas · vie 9 oct» con «Deshacer». Escribo «12.50 café»: «Gasto: S/ 12.50 · café».
6. Escribo algo que no entiende («ideas para el viaje»): queda en la bandeja tal cual y el bot lo dice.
7. En Ajustes → Avisos conecto Telegram con un enlace de un solo uso, apago los montos o muevo el briefing a las 8:00.
8. Otra persona escribe al bot: no responde nada y no se guarda nada.
9. En el iPhone, desde la app instalada, toco «Activar en este dispositivo» en Ajustes → Avisos, acepto el permiso y el briefing de mañana llega como notificación; al tocarla se abre `/`.
10. Elijo «Canal de avisos»: Push (por defecto), Telegram o Ambos. La captura por texto sigue siendo del bot.

## Decisiones

**Del owner (2026-10-06, tras el benchmark; ver `docs/HANDOFF.md`):**

| Tema | Decisión |
|---|---|
| Canal | Telegram (Bot API gratuita, webhook HTTPS en Vercel) para captura y avisos; push web también en este módulo (decisión del 2026-10-08, abajo). WhatsApp descartado. |
| Dónde vive el bot | Dentro de `reminders`: vinculación, webhook y envío. No es módulo aparte ni reabre `core`. |
| Avisos v1 | Los cuatro de arriba. Tono: nunca «racha», «riesgo», «⚠️» ni contadores de deuda. |
| Horarios por defecto | Briefing 7:30, repaso de la noche 21:00 (el modo cierre de la portada, 20:00, es de `today`); todos editables. |
| Montos | Sí en Telegram, con interruptor para apagarlos. |
| Hábitos | `reminder_time` y `daypart` en `habits`; `daypart` además agrupa los pads de Hoy por franja. |
| Secretos | El token del bot lo pone el owner en su terminal (`gh secret set` / Vercel). Nunca pegado en la sesión. |

**Del owner (2026-10-08):**

| Tema | Decisión |
|---|---|
| Disparador | Vercel Hobby solo da 1 cron diario, así que el motor se dispara con un workflow de **GitHub Actions cada 15 min** que llama a un endpoint protegido. Gratis mientras el repo sea público. |
| Autonomía | Autónomo hasta el Checkpoint final (como `today` y `finance`). |
| Push web | Entra en este módulo (corte R5), no en uno posterior. Selector «Canal de avisos»: Push, Telegram o Ambos; **por defecto Push para avisos y Telegram para captura**. |
| Dependencia | Se aprueba `web-push` para firmar y cifrar los envíos (solo servidor). |
| Montos en push | Apagados por defecto (se leen en la pantalla bloqueada); con interruptor propio. En Telegram siguen según `show_amounts_telegram`. |

**Autónomas, para revisar con el owner** (opción conservadora; a anotar en HANDOFF al implementar):

| Tema | Decisión |
|---|---|
| Idempotencia | Cada aviso tiene una `dedupe_key` única (`briefing:2026-10-08`, `payment_eve:<pago>:<vence>`, …). El motor la _reclama_ con `INSERT … ON CONFLICT DO NOTHING` antes de enviar: dos ticks a la vez envían una sola vez. |
| Ventana de gracia | Un aviso se envía hasta **2 h** después de su hora (GitHub retrasa los `schedule`). Pasada la ventana queda `skipped`: un briefing a las 14:00 es ruido. |
| Reintentos | Solo se reintenta un fallo **inequívoco**: Telegram contestó con un error (`server`, `bad_request`, `rate_limited`) o el texto no se pudo construir. El siguiente tick lo reintenta dentro de la ventana, máximo 3 intentos; sin bucles. Un fallo **ambiguo** (timeout o error de red: el mensaje pudo llegar) **no** se reintenta: queda `failed`, porque un aviso doble es peor que uno perdido. `rate_limited` no se reintenta dentro del mismo tick (ese canal se deja en paz hasta el siguiente). Telegram 403 (bot bloqueado) desconecta el chat (solo si sigue siendo el vinculado) y lo dice en Ajustes; no se reintenta. |
| Red de seguridad | Un cron diario de Vercel (`0 13 * * *` = ~8:00 Lima; Hobby solo garantiza la precisión de la hora, o sea 8:00–8:59, dentro de la ventana 7:30–9:30 del briefing por defecto) llama al mismo endpoint: si Actions no corre, el briefing igual sale. Es gratis y reutiliza la idempotencia. |
| Coste al volver a privado | 15 min = ~2 900 min/mes (> 2 000 gratis). Antes del ~2026-11-01 pasar a cada 30 min y solo 06:00–23:30 Lima (~1 100 min/mes); la hora de un hábito pasa a tener precisión de 30 min. Anotado en el backlog «Minutos de CI». |
| Registro del webhook | Un botón «Conectar» en Ajustes llama a `setWebhook` con el token del servidor, para que nadie tenga que manejar el token fuera de las variables de entorno. |
| Texto implícito = gasto | Solo si el monto tiene decimales o marca de moneda («12.50», «S/ 12», «$5»). «pilas 3» o «café 12» son tareas; para un entero usar `/gasto café 12`. Siempre hay «Deshacer». |
| `today` | No muestra avisos pendientes: la portada ya muestra los datos que los originan. |
| Respaldo de canal | El canal por defecto es Push, pero mientras no haya un dispositivo suscrito los avisos salen por Telegram si está conectado (Ajustes lo dice). Sin ningún canal activo no se envía nada. |
| Service worker | Solo `push` y `notificationclick`; **sin `fetch` ni caché**, para no servir HTML viejo tras un deploy. Alcance `/`, archivo `public/sw.js` con cabecera `no-cache`. |
| Notificación | Título «brahua-os», cuerpo = el mismo texto del aviso, `tag` = la `dedupe_key` (reemplaza en vez de apilar), clic abre `/`. |
| Retención | `reminder_deliveries` no se poda en v1 (< 10 filas al día). |

## Pantallas

- **Ajustes → Avisos** (`/settings/reminders`, el recorrido exacto lo fija el plan): **«Canal de avisos»** (Push · Telegram · Ambos); estado de Push (sin permiso / activo en N dispositivos) con «Activar en este dispositivo» y «Desactivar»; estado de Telegram (sin conectar / conectado desde el … / bot bloqueado); «Conectar» (genera el enlace `t.me/<bot>?start=<código>`, caduca en 10 min) y «Desconectar»; un interruptor por aviso con su hora (briefing, repaso) y los interruptores de montos (uno por canal). Cada control con `aria-disabled` mientras guarda, no `disabled`.
- **Hábito (crear/editar):** campos opcionales «Hora del aviso» (`type=time`, 48 px) y «Franja» (mañana / tarde / noche).
- **Hoy:** con hábitos con franja, los pads se agrupan por franja (Mañana, Tarde, Noche, y «Sin franja» al final). Sin ninguna franja, la pantalla queda como hoy.
- **Telegram:** mensajes cortos en español, sin formato de culpa, con enlace a `https://os.brahua.com`.

## Modelo de datos

Migración aditiva `drizzle/0013_reminders.sql`; sin borrados físicos de datos del owner.

| Tabla | Campos clave |
|---|---|
| `reminder_settings` (fila única: `id = true` + `CHECK`) | `delivery_channel` (`push` · `telegram` · `both`, por defecto `push`), `briefing_enabled`, `briefing_time`, `payments_enabled`, `evening_enabled`, `evening_time`, `habit_times_enabled`, `show_amounts_telegram`, `show_amounts_push` (por defecto apagado), `telegram_chat_id bigint null`, `linked_at`, `updated_at`. Horas `time` sin segundos (hora de Lima). |
| `telegram_link_codes` | `code_hash` (SHA-256, nunca el código), `expires_at`, `used_at`. Un solo código vivo. |
| `push_subscriptions` | `id`, `endpoint` **único**, `p256dh`, `auth`, `user_agent` (≤ 200, para mostrar «iPhone»), `created_at`, `last_success_at`, `revoked_at`. Un 404/410 del servicio de push la revoca (no se borra). Las claves son secretos: fuera de logs. |
| `reminder_deliveries` | `id`, `kind` (enum), `channel` (`push` · `telegram`), `dedupe_key`, **único `(dedupe_key, channel)`**, `scheduled_for timestamptz`, `status` (`pending` · `sent` · `skipped` · `failed`), `attempts`, `sent_at`, `telegram_message_id`, `error_code`. Nunca guarda el texto ni los montos. |
| `telegram_updates` | `update_id` PK: Telegram reintenta, esto evita procesar dos veces el mismo mensaje. |
| `telegram_captures` | `id`, `update_id`, `entity_kind` (`task` · `expense`), `entity_id`, `created_at`: lo que necesita «Deshacer» (el botón lleva el `id` de la captura, nunca el de la entidad). |
| `habits` (cambio) | `reminder_time time null`, `daypart text null` (`morning` · `afternoon` · `evening`). `CHECK`: `reminder_time` solo con hábitos que no son «a evitar». |

`pnpm db:export` incluye todas salvo `telegram_link_codes` y `push_subscriptions` (llevan secretos y se recrean activando el dispositivo). Zona horaria `America/Lima` (UTC−5 fijo, sin verano): los instantes se calculan con aritmética como `natural-date.ts`.

## Motor de avisos

**Disparo.** `.github/workflows/reminders-tick.yml` (`schedule: */15 * * * *`, también `workflow_dispatch`) hace `POST /api/reminders/tick` con `Authorization: Bearer $REMINDERS_CRON_SECRET`; el endpoint compara en tiempo constante y responde 404 a cualquier otro. Los `schedule` de GitHub solo corren en la rama por defecto y se pausan tras 60 días sin actividad: el cron diario de Vercel lo cubre.

**Fuentes (contrato).** `src/modules/reminders/contracts.ts` define `registerReminderSource(source)`, como `registerProgressSource`. Una fuente expone `candidates(ctx) → ReminderCandidate[]` con `{ kind, dedupeKey, dueAt, build }`. `tasks`, `habits` y `finance` implementan su fuente e importan solo `reminders/contracts`; la raíz de composición `src/lib/reminder-sources.ts` las registra **por nombre** (nunca `import "…"` a secas, lección de `progress-sources`). `reminders` no importa módulos.

**Un tick**, en orden: (1) autorizar; (2) cargar `reminder_settings` (sin chat conectado → termina); (3) pedir candidatos a las fuentes para `now` en Lima; (4) por cada uno con `dueAt ≤ now < dueAt + 2 h` y su interruptor activo: _reclamar_ la `dedupe_key`; (5) construir el mensaje (vacío → `skipped`); (6) enviar por cada canal activo según `delivery_channel` (push: a cada suscripción vigente; Telegram: `sendMessage`), cada uno con su propia fila de entrega; (7) registrar `sent`/`failed` por canal. Un candidato nunca bloquea a otro (un error se registra con `describeError` y se sigue).

**Avisos.**

| Kind | Cuándo | Contenido |
|---|---|---|
| `briefing` | `briefing_time` | ≤ 3 líneas: hábitos de hoy, tareas que vencen, pagos de hoy (con montos si el canal tiene montos activos). Vacío → `skipped`. |
| `payment_eve` | la víspera, a `briefing_time` | Pagos que vencen mañana. |
| `payment_followup` | 3 días después, a `briefing_time` | Un único aviso si sigue pendiente. |
| `evening_review` | `evening_time` | Solo si hay hábitos de hoy sin cumplir y no pausados. |
| `habit_time` | `reminder_time` del hábito | Solo si le toca hoy, no está hecho ni pausado. |

**Cruce de medianoche (R2).** La ventana de 2 h puede cruzar la medianoche, pero un aviso «del día» no se rehace para ayer: `briefing` y `evening_review` solo se ofrecen para el día de Lima en curso (un repaso de las 23:30 sale si el tick llega antes de la medianoche, p. ej. a las 23:45; a las 00:30 ya no se manda, porque hablaría de un día que terminó). `payment_eve` conserva el cruce («Hoy vence …») porque su fecha de vencimiento no cambia; `habit_time` (R4) también, porque la hora del hábito pertenece al día que termina. El interruptor «Avisos de pagos» gobierna solo `payment_eve` y `payment_followup`: los pagos que vencen **hoy** siguen en el `briefing`, que tiene el suyo.

## Push web

- **Interfaz** `ReminderChannel { id, send(message) }` con `telegramChannel` y `webPushChannel`; el motor no conoce más que la interfaz.
- **Suscribir:** botón en Ajustes (gesto del usuario, exigido por iOS) → `Notification.requestPermission()` → `registration.pushManager.subscribe({ applicationServerKey })` → Server Action que guarda la suscripción. Solo se ofrece si la app está instalada y el navegador soporta push (en iPhone, PWA en pantalla de inicio, iOS 16.4+); si no, Ajustes explica cómo instalarla en lugar de un botón muerto.
- **Enviar:** `web-push` con VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); TTL de 2 h (igual que la ventana de gracia) y urgencia normal. 404/410 → revocar; otros errores → reintento del motor (máx. 3).
- **Claves:** un script `pnpm reminders:vapid` genera el par y lo imprime **solo la pública**; la privada la guarda el owner en su terminal (`gh secret set` / Vercel), nunca en la sesión. `VAPID_PUBLIC_KEY` también se expone al cliente (`NEXT_PUBLIC_…`).
- **Service worker** `public/sw.js`: escucha `push` (muestra la notificación, sin abrir canales extra) y `notificationclick` (enfoca o abre `/`). Se registra al activar, no en cada carga.

## Bot de Telegram

- **Webhook** `POST /api/telegram/webhook`: valida `X-Telegram-Bot-Api-Secret-Token` en tiempo constante (si no coincide, 401 sin leer el cuerpo), limita el tamaño del cuerpo, deduplica por `update_id` y **solo atiende al `telegram_chat_id` vinculado**. Un chat desconocido recibe 200 sin respuesta, salvo `/start <código>` válido.
- **Vinculación:** código de 8 caracteres (alfabeto de 32, `crypto.randomBytes`), caduca a los 10 min, un solo uso. Los intentos fallidos se limitan **sin tocar los códigos** (un tercero no debe poder apagar la vinculación del owner): tras 5 fallidos de un mismo chat en una hora ese chat se ignora, y con más de 30 fallidos de cualquier chat en 10 minutos todo intento recibe «inválido» sin comprobarse. Un código mal formado cuenta como intento de su chat. Un chat ya vinculado ignora `/start` de otros.
- **Captura:** `parseTaskText(text, new Date())` → `createTask({ title, dueDate, dueTime })`; con monto con decimales o moneda, `parseExpenseText` → `createExpense`; `/gasto …` fuerza gasto, `/tarea …` fuerza tarea. Se reutilizan las acciones de dominio (la validación sigue mandando), no las Server Actions del navegador. La respuesta resume lo interpretado y lleva el botón «Deshacer» (callback con el `id` de `telegram_captures`; si la entidad ya cambió, no la pisa y lo dice).
- **Comandos:** `/start`, `/ayuda`, `/gasto`, `/tarea`, `/hoy` (el resumen del briefing bajo demanda). Nada más.
- **API de Telegram** tras una interfaz `TelegramClient` (`sendMessage`, `answerCallbackQuery`, `setWebhook`); la URL base es configurable (`TELEGRAM_API_BASE`, por defecto la oficial) para que las pruebas usen un servidor falso local, sin ramas de prueba en el código de producción.

## Contratos

- **Con `finance`:** `getUpcomingPayments(from, to)` (cuerpo en `finance/contracts.ts`, sobre `schedule.ts` puro y `pendingPeriods`) → `{ recurringId, name, dueOn, amountCents, currency }`. Alimenta `payment_eve`, `payment_followup` y el briefing.
- **Con `habits`:** `getHabitsReminderCandidates(day)` → hábitos de hoy no hechos ni pausados, con `reminderTime` y `daypart`; reutiliza `getHabitsTodaySummary`.
- **Con `tasks`:** `getTasksTodaySummary` (ya existe) para el briefing. El instante de una tarea (`due_date` + `due_time` en Lima) queda documentado para el corte de «tarea a su hora».
- **Con `core`:** captura rápida y settings no cambian de dueño; el webhook usa las acciones de dominio de `tasks` y `finance` a través de la raíz de composición (`src/lib/bot-capture.ts`).
- **Límites:** `reminders` solo importa `core`; `tasks`, `habits` y `finance` importan únicamente `@/modules/reminders/contracts` (regla nueva en `eslint.config.mjs`).

## Comandos y estructura

Los mismos de `SPEC-core`, más:

```
Registrar webhook:  botón «Conectar» en Ajustes (usa el token del servidor)
Tick manual:        gh workflow run reminders-tick.yml --ref main
Variables:          TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME,
                    REMINDERS_CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
                    (Vercel y secretos del repo; los pone el owner)
Claves VAPID:       pnpm reminders:vapid   (imprime solo la pública)
```

```
src/modules/reminders/   → module.ts, db/schema.ts, contracts.ts, slots.ts (puro: instantes y ventana),
                           messages.ts (puro: copy), engine.ts, channels/ (telegram: client, webhook, link, capture; web-push), push/ (suscripciones)
src/app/api/reminders/tick/route.ts
src/app/api/telegram/webhook/route.ts
public/sw.js   → service worker solo de push
src/lib/reminder-sources.ts, src/lib/bot-capture.ts   → raíces de composición
.github/workflows/reminders-tick.yml
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | `slots.ts` (cada aviso en Lima: 23:59, medianoche, ventana de 2 h, víspera, +3 días); elección de canales y respaldo (`delivery_channel` × suscripciones × Telegram); `messages.ts` (longitud ≤ 3 líneas, sin montos con el interruptor apagado, **ninguna cadena prohibida**: «racha», «riesgo», «⚠️», «atrasad», «deuda»); clasificación de texto del bot (tarea / gasto / fuerza / no entiende); validación de código; Zod de Ajustes. |
| Integración | `CHECK` con inserts crudos; **dos ticks concurrentes → un solo envío** (con control positivo: dos claves distintas → dos); ventana vencida → `skipped`; fallo de Telegram → reintento y tope de 3; 403 desconecta; webhook sin secreto → 401, chat ajeno → nada guardado, `update_id` repetido → una sola entidad; vincular (válido, caducado, reutilizado, 5 fallos); captura + «Deshacer» exacto (entidad editada no se pisa); autorización de las acciones de Ajustes; export sin `telegram_link_codes`. Telegram se simula con el servidor falso; el servicio de push, con un servidor local que responde 201/404/410 (suscripción revocada en 410; una entrega por canal; un canal que falla no bloquea al otro). |
| Componentes | Ajustes → Avisos (foco, `aria-disabled`, aviso de guardado), campos de hábito, pads agrupados por franja. |
| E2E | Conectar con el servidor falso y ver «Conectado»; apagar un aviso; mover la hora; hábito con franja en Hoy; axe en ambos temas y 320 px; captura de Ajustes. Con `@today-*` si `/` cambia (lección de `today`). Selector de canal y alta/baja de una suscripción con un `PushManager` simulado. El envío real a Telegram y a Apple Push **no** se prueba en CI. |

Local: solo el gate liviano (prettier, eslint, typecheck y las unitarias tocadas); lo demás lo valida el CI.

## Límites

- **Siempre:** las de `SPEC-core` y los módulos anteriores y las lecciones de `CLAUDE.md` (`ownerAction`/`requireOwner`, foco, locks de dos claves, `describeError`, temporizadores limpiados). Rutas `api` de tick y webhook: autenticar **antes** de leer el cuerpo. Mensajes y logs sin texto del usuario, montos, tokens ni claves de suscripción. El service worker nunca cachea ni intercepta `fetch`.
- **Preguntar primero:** otras dependencias además de `web-push` (aprobada), cualquier otro canal o servicio externo (email, Groq), cambiar la frecuencia del cron, escribir en producción fuera de migraciones aditivas.
- **Nunca:** el token del bot, el secreto del webhook, el del cron o la clave privada VAPID en el repo, en la sesión o en logs; atender a un chat no vinculado; texto de culpa o conteo de deuda; borrado físico de datos del owner; que un módulo distinto de `reminders` importe algo que no sea sus `contracts`.

## Criterios de éxito

1. **Briefing:** a la hora configurada llega una vez, con ≤ 3 líneas; un día vacío no envía nada (integración con reloj fijo).
2. **Idempotencia:** dos ticks a la vez, o un reintento de Actions, nunca duplican un aviso.
3. **Pagos y hábitos:** víspera, +3 días, repaso y hábito a su hora salen solo cuando corresponden; no salen si ya está hecho o pausado.
4. **Bot:** «pilas mañana» → tarea con su fecha; «12.50 café» → gasto; lo no entendido → bandeja; «Deshacer» exacto; ≤ 5 s de respuesta.
5. **Seguridad:** sin secreto → 401; chat ajeno → nada; el código de vinculación caduca y se usa una vez; ningún secreto en el repo ni en logs.
6. **Push:** activar en el iPhone instalado entrega el briefing como notificación y el clic abre `/`; un 410 revoca la suscripción; el service worker no tiene `fetch`; los montos no salen en push por defecto.
7. **Ajustes:** se conecta, se desconecta y se configura todo desde la app, sin terminal salvo poner las variables.
8. **Hábitos:** `reminder_time` y `daypart` se guardan; Hoy agrupa por franja sin cambiar nada para quien no las use.
9. **Calidad:** CI en verde; axe en 0 en ambos temas; sin movimiento con `prefers-reduced-motion`; ninguna cadena prohibida en los mensajes; tablas en `pnpm db:export` y en el respaldo.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec. Un implementador a la vez (gate liviano), en este orden.

- **R1 — Cimientos:** migración, `reminder_settings`, cliente de Telegram + servidor falso, vinculación (Ajustes → Conectar / Desconectar), endpoint `tick` con autenticación, workflow y cron de Vercel; el motor con un solo aviso de prueba (`briefing` vacío).
- **R2 — Avisos de la app:** fuentes de `tasks`, `finance` y `habits`; briefing, pago (víspera y +3 días), repaso de la noche; interruptores y horas en Ajustes.
- **R3 — Captura por texto:** webhook, clasificación, tarea y gasto, «Deshacer», `/hoy`, `/ayuda`.
- **R4 — Hábitos con hora y franja:** columnas, campos en el hábito, aviso `habit_time`, pads agrupados en Hoy.
- **R5 — Push web:** dependencia `web-push`, `ReminderChannel` (se extrae en R1), `push_subscriptions`, `public/sw.js`, alta/baja en Ajustes, selector de canal con respaldo, script de claves VAPID. La prueba real en el iPhone es del owner (PWA reinstalada).
- **R6 — Cierre:** guía de puesta en marcha (el owner pone las variables), E2E, retrospectiva y Checkpoint final con una prueba real en el iPhone (el envío real a Telegram y a Apple Push es del owner).

R1 define la interfaz `ReminderChannel` con Telegram como única implementación. R2, R3 y R4 son independientes tras R1 y podrían ir en paralelo (cada uno con su `TEST_DB_PORT` y `E2E_PORT`), pero por defecto van en serie.

## Preguntas abiertas

1. **Tarea a su hora:** el owner fijó «los cuatro» avisos; el contrato de `task-time` (`due_date` + `due_time`) ya permite un quinto, «Es hora de: pilas». ¿Entra en v1? _Recomendado: no; es un corte chico después de R4._
2. **Nombre del bot:** el owner lo crea con @BotFather y elige el `@usuario`; la spec solo necesita `TELEGRAM_BOT_USERNAME`.
