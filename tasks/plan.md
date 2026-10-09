# Plan de implementación: reminders

> Spec: [`SPEC-reminders.md`](../SPEC-reminders.md) (APROBADO v1.1, 2026-10-08) · Tareas: [`todo.md`](todo.md) → "Módulo `reminders`"
> Planes anteriores en [`archive/`](archive/).

## Enfoque

El de los módulos anteriores: rebanadas verticales (datos + pantalla + pruebas), un implementador a la vez en worktree → PR → revisores (`code-reviewer`, `test-engineer`, `security-auditor` en R1, R3 y R5 por secretos, webhook y datos; accesibilidad si toca UI) → CI verde (verificado antes de cada merge) → deploy y smoke. Autónomo hasta el **Checkpoint final**; lo no cubierto por la spec: opción conservadora, anotada en HANDOFF como «decisión autónoma para revisar con el owner».

Gate local liviano (`CLAUDE.md`): prettier, eslint, typecheck y solo las unitarias tocadas. Build, integración, E2E y capturas, en CI. Cada agente hace push **una vez**. Tras un push que cambia lo visual: `gh workflow run update-screenshots.yml`.

## Orden y dependencias

```
R1 cimientos ─┬─> R2 avisos de la app ──┐
              ├─> R3 captura por texto  ├─> R6 cierre
              ├─> R4 hábitos con hora ──┤
              └─> R5 push web ──────────┘
```

- **R1** es la base y deja los **slots**: `ReminderChannel` (Telegram como única implementación), el registro de fuentes `registerReminderSource`, la sección Ajustes → Avisos con su layout, la raíz `src/lib/reminder-sources.ts` y el endpoint `tick`.
- **R2, R3, R4 y R5** son independientes tras R1. Por defecto van en serie: R2 → R4 → R3 → R5 (R2 y R4 comparten la fuente de hábitos; R5 necesita que el selector de canal ya exista en Ajustes). Si el owner pide paralelo: cada uno con su `TEST_DB_PORT`, `E2E_PORT` y un orden de merge; los conflictos esperados son docs/HANDOFF y el layout de Ajustes.
- **R4 toca `habits` y `today`** (columnas, formulario del hábito, pads agrupados por franja): E2E con las etiquetas `@today-*`.
- **R6** cierra: guía de puesta en marcha, retrospectiva, Checkpoint.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Aviso duplicado (ticks solapados, reintento de Actions) | `dedupe_key` única por canal reclamada con `INSERT … ON CONFLICT DO NOTHING` antes de enviar; prueba de integración con dos ticks a la vez y control positivo. |
| Avisos tardíos por retraso de `schedule` de GitHub | Ventana de gracia de 2 h; pasada, `skipped`. Cron diario de Vercel como red de seguridad del briefing. |
| Secretos (token del bot, webhook, cron, VAPID privada) | Los pone el owner en su terminal; el código nunca los imprime ni los registra; el endpoint autentica antes de leer el cuerpo. |
| Webhook abierto a terceros | `secret_token` en tiempo constante, lista de un solo chat, `update_id` deduplicado, código de vinculación de un solo uso y con tope de intentos. |
| «Deshacer» del bot pisa una edición | El botón lleva el id de la captura, nunca el de la entidad, y no pisa si la entidad cambió (lección «Undo targets the exact row»). |
| Tono de culpa en los mensajes | Test unitario con lista de cadenas prohibidas sobre todos los mensajes. |
| Service worker sirve HTML viejo | Sin `fetch` ni caché; `sw.js` con `no-cache`; solo `push` y `notificationclick`. |
| iPhone: push solo con PWA instalada, sin prueba posible en Playwright | Estado explicado en Ajustes; la prueba real es del owner en el Checkpoint, con la app reinstalada. |
| Minutos de CI al volver el repo a privado | Ya registrado en el backlog («Minutos de CI»); el workflow nace a 15 min mientras el repo sea público. |
| E2E de `/` y Ajustes comparten datos | `boardTest` y `@today-*`; la tabla `reminder_settings` es de fila única: serializar los tests que la mutan. |
| Telegram y Apple Push no se pueden probar en CI | Servidores falsos locales vía `TELEGRAM_API_BASE` y un endpoint de push de prueba; sin ramas de prueba en producción. |

## Checkpoints

- **Checkpoint final:** el owner crea el bot con @BotFather y pone las variables en su terminal (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, `REMINDERS_CRON_SECRET`, `CRON_SECRET`, claves VAPID y `VAPID_SUBJECT`; paso a paso en `docs/reminders-setup.md`). El agente recorre Ajustes → Avisos en producción con el Chrome del owner (datos `[QA]`, luego borrados). El owner prueba en el iPhone: conectar Telegram, escribir «pilas mañana», activar el push en la PWA reinstalada y recibir un aviso real.
