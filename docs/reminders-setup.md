# Puesta en marcha de `reminders` (guía del owner)

> Para el owner. Todo se hace **en tu propia terminal** (Terminal.app o iTerm), nunca en la sesión de Claude: los secretos no se pegan ahí, y el prefijo `!` de la sesión guarda los secretos **vacíos**, así que tampoco sirve para esto.
> Verificada contra el código el 2026-10-09: `src/modules/reminders/env.ts`, `.github/workflows/reminders-tick.yml`, `vercel.json`, `scripts/reminders-vapid.ts`, `package.json`, `src/app/api/reminders/tick/route.ts` y los textos de Ajustes → Avisos.

## Qué vas a dejar funcionando

1. Un bot de Telegram propio que te manda los avisos y recibe tus capturas por texto («pilas mañana», «12.50 café»).
2. Notificaciones push en el iPhone (PWA instalada).
3. El disparador: un workflow de GitHub Actions que llama cada 15 minutos a `POST /api/reminders/tick`, más un cron diario de Vercel (~8:00 Lima) como red de seguridad del resumen de la mañana.

Sin las variables la app no se rompe: Ajustes → Avisos nombra lo que falta y el tick responde 404.

## Antes de empezar

```bash
cd ~/dev/projects/brahua-os
nvm use                       # Node 24 (.nvmrc)
gh api user -q .login         # debe decir: Brahua
vercel whoami                 # tu cuenta de Vercel (proyecto brahua-os, equipo Brahua Lab)
```

Si `gh` dice `jbrahua`: `env -u GH_TOKEN gh auth switch -h github.com -u Brahua`. Si `vercel` no está enlazado a este directorio, `vercel link` y elige el proyecto `brahua-os`.

## Las variables

| Variable | Dónde | Qué es |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Vercel (Production, Sensitive) | El token que te da @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Vercel (Production, Sensitive) | Lo inventas tú: 16 a 256 caracteres de `A-Za-z0-9_-`. Telegram lo manda en cada petición y el webhook lo exige. |
| `TELEGRAM_BOT_USERNAME` | Vercel (Production) | El `@usuario` del bot, con o sin `@`. No es secreto. |
| `REMINDERS_CRON_SECRET` | Vercel (Production, Sensitive) **y** secreto del repo | 16+ caracteres. Es el que manda el workflow de Actions. |
| `CRON_SECRET` | Vercel (Production, Sensitive) | **El mismo valor** que `REMINDERS_CRON_SECRET`. Es el que manda el cron diario de Vercel (solo sabe usar ese nombre). |
| `VAPID_PUBLIC_KEY` | Vercel (Production) | Sale de `pnpm reminders:vapid`. |
| `VAPID_PRIVATE_KEY` | Vercel (Production, Sensitive) | Idem. Es secreta. |
| `VAPID_SUBJECT` | Vercel (Production) | `https://os.brahua.com` o `mailto:tu@correo`. Es a quien contactan los servicios de push. |

Notas:

- `BETTER_AUTH_URL` (ya existe, `https://os.brahua.com`) es el origen que se registra como webhook y el enlace que llevan los mensajes. No hay que tocarlo.
- `TELEGRAM_API_BASE` es solo para pruebas: **no la pongas** en Vercel.
- Ninguna de estas variables entra al build: si faltan, el deploy no falla.
- Ningún job de Actions necesita las claves de Telegram ni las VAPID; en el repo solo va `REMINDERS_CRON_SECRET`.

## Paso 1. Crear el bot con @BotFather

1. En Telegram abre **@BotFather** (el que tiene la marca de verificación) y envía `/newbot`.
2. Nombre visible: el que quieras (p. ej. `brahua-os`). Usuario: debe terminar en `bot` (p. ej. `brahua_os_bot`). Si está tomado, prueba otro.
3. BotFather te responde con el **token** (`123456789:AA…`). **No lo pegues en la sesión de Claude ni en ningún chat**: cópialo y pásalo al paso 2 (se pega en un prompt oculto de tu terminal).
4. Opcional, para que Telegram sugiera los comandos: `/setcommands`, elige tu bot y envía:

   ```
   ayuda - Qué puedo hacer
   hoy - Resumen de hoy
   tarea - Anotar una tarea
   gasto - Anotar un gasto
   ```

5. No hace falta tocar `/setprivacy` ni `/setjoingroups`: el bot solo se usa en chat privado contigo. Si alguien más le escribe, no responde ni guarda nada.

Anota el usuario del bot (sin el `@`): es `TELEGRAM_BOT_USERNAME`.

## Paso 2. Poner las variables (sin pegar secretos en la sesión)

Cada comando `vercel env add … production` pide el valor en un prompt oculto; pégalo ahí. Si la variable ya existe, añade `--force` para reemplazarla.

### 2.1 Telegram

```bash
# Token del bot: pégalo en el prompt (no se ve).
vercel env add TELEGRAM_BOT_TOKEN production --sensitive

# Secreto del webhook: se genera y se guarda sin que lo veas ni lo copies.
openssl rand -hex 24 | vercel env add TELEGRAM_WEBHOOK_SECRET production --sensitive

# Usuario del bot (no es secreto): escribe, por ejemplo, brahua_os_bot
vercel env add TELEGRAM_BOT_USERNAME production
```

El botón «Conectar Telegram» de Ajustes registra el webhook con ese token y ese secreto (`setWebhook` desde el servidor), así que normalmente **no necesitas** conocer el secreto del webhook. Solo lo necesitarías para el registro manual del paso 5 (alternativa); en ese caso genera y guarda el valor así, en vez de la línea de arriba:

```bash
TG_WEBHOOK_SECRET="$(openssl rand -hex 24)"
printf %s "$TG_WEBHOOK_SECRET" | vercel env add TELEGRAM_WEBHOOK_SECRET production --sensitive
# Déjalo en esta terminal para el paso 5 y bórralo al terminar: unset TG_WEBHOOK_SECRET
```

### 2.2 Secreto del tick (Vercel y GitHub, el mismo valor)

El valor lo necesitarás otra vez para probar el tick a mano (paso 6) y las variables de Vercel marcadas Sensitive no se pueden leer después. Genéralo, **guárdalo en tu gestor de contraseñas** y úsalo desde el portapapeles:

```bash
openssl rand -hex 32 | pbcopy          # al portapapeles, sin mostrarlo; pégalo en tu gestor de contraseñas
read -rs 'CRON_VALUE?Pega el secreto (no se ve): ' ; echo
printf %s "$CRON_VALUE" | vercel env add REMINDERS_CRON_SECRET production --sensitive
printf %s "$CRON_VALUE" | vercel env add CRON_SECRET production --sensitive
printf %s "$CRON_VALUE" | gh secret set REMINDERS_CRON_SECRET --repo Brahua/brahua-os
unset CRON_VALUE
```

(`read -rs` es de zsh; en bash sería `read -rsp 'Pega el secreto: ' CRON_VALUE`.) Si el CLI de Vercel te pregunta algo (entornos, etc.), responde en el prompt: solo queremos `Production`.

Comprobar que existe el secreto del repo (muestra nombres, no valores):

```bash
gh secret list --repo Brahua/brahua-os | grep REMINDERS_CRON_SECRET
```

### 2.3 Claves VAPID (push)

```bash
pnpm reminders:vapid
```

Imprime, **solo en la terminal** (se niega si la salida no es una terminal), dos líneas: `VAPID_PUBLIC_KEY=…` y `VAPID_PRIVATE_KEY=…`. Cópialas a Vercel y borra la pantalla (`clear`). No las pegues en ningún chat.

```bash
vercel env add VAPID_PUBLIC_KEY production                     # pega solo el valor (sin "VAPID_PUBLIC_KEY=")
vercel env add VAPID_PRIVATE_KEY production --sensitive        # pega solo el valor
vercel env add VAPID_SUBJECT production                        # escribe: https://os.brahua.com  (o mailto:tu@correo)
```

Las dos claves deben ser **un par**: el servidor comprueba que la privada derive la pública; si no, el push queda «no disponible» y los avisos caen a Telegram.

Comprobar que están las siete (muestra nombres y entornos, no valores):

```bash
vercel env ls production | grep -E 'TELEGRAM_|CRON_SECRET|VAPID_'
```

## Paso 3. Redeploy de producción

Las variables nuevas **no llegan a un despliegue ya hecho**. El único que despliega es el job `deploy` de `ci.yml` (solo en `push` a `main`; un `workflow_dispatch` nunca despliega). Dos formas:

- **Volver a correr el deploy del último push a `main`** (no corre los tests otra vez):

  ```bash
  RUN="$(gh run list --repo Brahua/brahua-os --workflow ci.yml --branch main --event push --status success --limit 1 --json databaseId -q '.[0].databaseId')"
  JOB="$(gh run view "$RUN" --repo Brahua/brahua-os --json jobs -q '.jobs[] | select(.name=="Deploy to production") | .databaseId')"
  gh run rerun "$RUN" --repo Brahua/brahua-os --job "$JOB"
  gh run watch "$RUN" --repo Brahua/brahua-os
  ```

  El `smoke` corre solo después.

- O simplemente el siguiente merge a `main` (despliega con las variables).

Cuando termine, abre https://os.brahua.com/settings/reminders: ya no debe decir que faltan variables.

## Paso 4. Vincular el chat de Telegram

1. https://os.brahua.com → Ajustes → **Telegram y avisos del día** → página **Avisos**.
2. En la sección Telegram toca **Conectar Telegram**. Esto registra el webhook (con `secret_token`) y genera un enlace de un solo uso, válido 10 minutos.
3. Toca **Abrir Telegram** (o abre el enlace en el iPhone), y en el chat del bot toca **Iniciar**.
4. Vuelve a la app: la sección debe decir «Conectado desde el …» (la pantalla consulta cada 3 s).
5. En el chat escribe `/ayuda`: el bot responde con lo que sabe hacer. Si no responde, ve a «Resolución de problemas».

«Conectar» se niega mientras haya un chat vinculado; para cambiarlo, **Desconectar** primero. Un código se usa una sola vez; si caduca, vuelve a tocar Conectar.

## Paso 5. (Alternativa) Registrar el webhook a mano

Solo si necesitas registrar el webhook **sin desconectar** el chat (p. ej. rotaste `TELEGRAM_WEBHOOK_SECRET` con el chat ya vinculado) o para diagnosticar. Variables de shell, sin valores en el comando:

```bash
read -rs 'TG_TOKEN?Token del bot: ' ; echo
read -rs 'TG_WEBHOOK_SECRET?Secreto del webhook (el mismo de Vercel): ' ; echo

curl -sS "https://api.telegram.org/bot${TG_TOKEN}/setWebhook" \
  --data-urlencode "url=https://os.brahua.com/api/telegram/webhook" \
  --data-urlencode "secret_token=${TG_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
# Esperado: {"ok":true,"result":true,"description":"Webhook was set"}

# Ver cómo quedó (no imprime secretos; mira "url", "pending_update_count" y "last_error_message"):
curl -sS "https://api.telegram.org/bot${TG_TOKEN}/getWebhookInfo"

unset TG_TOKEN TG_WEBHOOK_SECRET
```

Son los mismos parámetros que usa el botón «Conectar» (`url`, `secret_token`, `allowed_updates: ["message","callback_query"]`).

## Paso 6. Verificar el tick

**Con el workflow** (lo que corre cada 15 minutos):

```bash
gh workflow run reminders-tick.yml --ref main --repo Brahua/brahua-os
sleep 8
gh run list --repo Brahua/brahua-os --workflow reminders-tick.yml --limit 1
gh run view <id-del-run> --repo Brahua/brahua-os --log     # busca "HTTP 200" y el JSON de conteos
```

- `HTTP 200` y `{"ok":true,"status":"ok","candidates":…,"sent":…,"skipped":…,"failed":…}`: todo bien. `status: "no-channel"` también es 200: no hay ningún canal listo (Telegram sin conectar y sin dispositivo con push).
- `HTTP 404`: el secreto del repo no coincide con el de Vercel, o falta en Vercel, o el deploy es anterior a las variables.
- Un aviso amarillo «`REMINDERS_CRON_SECRET is not set: no tick sent`»: falta el secreto del repo (el job termina en verde sin enviar nada: **este paso de verificación existe por eso**).

**Con `curl`** (el mismo endpoint, el secreto sale de tu gestor de contraseñas):

```bash
read -rs 'CRON_VALUE?Secreto del tick: ' ; echo
printf 'Authorization: Bearer %s\n' "$CRON_VALUE" \
  | curl -sS --max-time 40 --request POST --header @- -w '\nHTTP %{http_code}\n' \
      https://os.brahua.com/api/reminders/tick
unset CRON_VALUE

# Sin secreto debe ser 404 (nadie debe poder saber que la ruta existe):
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -X POST https://os.brahua.com/api/reminders/tick
```

La respuesta solo trae conteos (sin textos ni ids).

**Qué mirar en los logs de Vercel** (cada línea es JSON; solo nombres, conteos y códigos, nunca textos, montos ni ids):

```bash
vercel logs --environment production --since 1h --query reminders_tick
vercel logs --environment production --since 1h --level error
```

| Evento | Qué significa |
| --- | --- |
| `reminders_tick` (info) | Un tick terminó: `status`, `candidates`, `sent`, `skipped`, `failed`. |
| `reminders_tick_unconfigured` (error) | El tick llegó pero el servidor no tiene `REMINDERS_CRON_SECRET`/`CRON_SECRET` de 16+ caracteres (la respuesta fue 404). |
| `reminders_tick_failed` (error) | El motor lanzó una excepción (respuesta 500). |
| `reminder_send_refused` (warn) | Un canal rechazó el envío; trae `kind`, `channel` y `code` (`telegram_unauthorized` = token malo; `telegram_server`/`push_server` = error del servicio, se reintenta hasta 3 veces). |
| `reminder_source_failed`, `reminder_build_failed`, `reminder_delivery_failed`, `reminder_send_threw` (error) | Una fuente o un aviso falló; el tick siguió con los demás. |
| `telegram_set_webhook_failed` (warn) | «Conectar» no pudo registrar el webhook (`kind`: `unauthorized` = token malo). |
| `telegram_linked`, `telegram_reply`, `telegram_undo` | Vinculación, respuestas del bot y «Deshacer». |
| `telegram_webhook_failed`, `telegram_today_failed` (error) | Falló el webhook o `/hoy`. |
| `push_vapid_rejected` (error), `push_subscriptions_revoked` (info) | El servicio de push rechazó las claves VAPID, o revocó dispositivos caducados. |

También puedes verlos en el panel de Vercel → proyecto → Logs → filtra por la ruta `/api/reminders/tick`.

**Un aviso real sin esperar a las 7:30:** crea un hábito `[QA] aviso` con «Hora del aviso» unos minutos **antes** de la hora actual (vale hasta 2 h antes) y lanza el tick; llega «Es hora de [QA] aviso.». Después borra el hábito.

## Paso 7. Activar el push en el iPhone

1. En el iPhone, abre https://os.brahua.com en Safari y **instala la app**: Compartir → «Añadir a pantalla de inicio». Si ya la tenías instalada, lo más seguro es **borrar el ícono y volver a añadirla** (descarta un manifiesto o ícono viejos; el HANDOFF dice que no siempre es obligatorio, pero cuesta un minuto y quita una causa posible).
2. Abre **brahua-os desde el ícono nuevo** (no desde Safari), inicia sesión (Face ID con la passkey) y ve a Ajustes → Avisos.
3. En **Canal de avisos** → «Este dispositivo» toca **Activar este dispositivo** (tiene que ser un toque tuyo: iOS no deja pedir el permiso de otra forma) y acepta el permiso de notificaciones.
4. Debe decir «Este dispositivo recibe avisos por push» y aparecer en «Dispositivos con push» («iPhone · Safari»…).
5. Elige el canal: **Push** (por defecto), **Telegram** o **Ambos**. Mientras no haya dispositivo con push, los avisos salen por Telegram si está conectado, y la pantalla lo dice.
6. «Montos en push» empieza apagado a propósito (se leen en la pantalla bloqueada).
7. Prueba: crea el hábito `[QA]` del paso 6 y lanza el tick; debe llegar una notificación «brahua-os» y al tocarla se abre la app en `/`.

## Resolución de problemas

**La pantalla dice «El bot todavía no está configurado en el servidor. Faltan variables de entorno.»** Falta alguna de `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (16–256 de `A-Za-z0-9_-`), `TELEGRAM_BOT_USERNAME` o `BETTER_AUTH_URL`, o está mal formada, o el deploy es anterior a ponerla (paso 3). La pantalla nombra solo la variable, nunca su valor.

**«Telegram no aceptó el registro del bot. Revisa el token e inténtalo de nuevo.»** El token es incorrecto o fue revocado. Vuelve a ponerlo (`vercel env add TELEGRAM_BOT_TOKEN production --sensitive --force`), redeploy y Conectar. Con `vercel logs … --query telegram_set_webhook_failed` ves el `kind`.

**El bot no responde a `/start` ni a `/ayuda`.**

- `curl … getWebhookInfo` (paso 5): `url` vacía = el webhook no está registrado (Conectar o paso 5). `last_error_message` con «401 Unauthorized» = el secreto que tiene Telegram no es el de Vercel (rotaste `TELEGRAM_WEBHOOK_SECRET` después de conectar): redeploy, **Desconectar** y **Conectar**, o el registro manual del paso 5. El webhook responde 401 sin leer el cuerpo si el secreto no coincide.
- Ahora el chat tiene que ser el vinculado: cualquier otro chat recibe silencio (200, nada guardado).
- Un código de `/start` caducado, usado o con 5 fallos en una hora de ese chat se ignora en silencio: toca Conectar de nuevo.

**403 del bot / «Telegram bloqueó el envío (¿bloqueaste el bot?)».** Telegram devolvió 403: bloqueaste el bot, lo borraste o lo sacaste del chat. El motor desconecta el chat (solo si sigue siendo el vinculado) y Ajustes lo muestra. Desbloquea el bot en Telegram y vuelve a **Conectar Telegram**. Un 403 al **responder** desde el webhook no desconecta nada (si estás escribiendo, no estás bloqueado). Si el token es malo, el código es `telegram_unauthorized` (401/404), no 403.

**«Telegram no está conectado, así que ahora no se envía ningún aviso» / «Ahora mismo no hay ningún canal listo…» (canal no disponible).** El canal elegido no puede enviar: Telegram sin conectar o bloqueado, y/o ningún dispositivo con push activo (`push` y `both` caen a Telegram si está conectado). Conecta Telegram o activa el dispositivo. Si dice «El push todavía no está configurado en el servidor», faltan o no son un par `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (o el deploy es anterior). El tick con ningún canal responde `status: "no-channel"` y no consulta las fuentes.

**«En iPhone y iPad el push solo funciona con la app instalada…» estando en la app.** Estás en Safari, no en el ícono. Si lo estás en el ícono y aun así sale, borra la app, vuelve a añadirla (paso 7).

**«El permiso de notificaciones está bloqueado…».** iOS no vuelve a preguntar: Ajustes de iOS → Notificaciones → brahua-os → Permitir. Si no aparece en la lista, borra la app y reinstálala.

**Rotación de las claves VAPID.** Rotar invalida todas las suscripciones (están atadas a la clave pública). Orden: (1) `pnpm reminders:vapid`; (2) reemplaza **las dos** (`vercel env add VAPID_PUBLIC_KEY production --force`, y `VAPID_PRIVATE_KEY production --sensitive --force`; nunca solo una: un par que no encaja deja el push no disponible); (3) redeploy; (4) en cada dispositivo, Ajustes → Avisos → **Desactivar** y **Activar este dispositivo** (si la clave cambió, la pantalla descarta la suscripción vieja y crea una nueva). Mientras tanto, el primer envío a una suscripción vieja recibe 401/403/410: se revoca y el aviso sale por Telegram si está conectado (se registra `push_vapid_rejected` o `push_subscriptions_revoked`). `VAPID_SUBJECT` se puede cambiar sin tocar las suscripciones.

**Rotación del token del bot** (`/revoke` en @BotFather): pon el token nuevo en Vercel (`--force`), redeploy y comprueba `getWebhookInfo`; si la `url` quedó vacía, **Desconectar** y **Conectar**.

**Rotación del secreto del tick:** cámbialo en los tres sitios con el mismo valor (`REMINDERS_CRON_SECRET` y `CRON_SECRET` en Vercel, `REMINDERS_CRON_SECRET` en el repo), redeploy. Si cambias solo uno, el workflow o el cron de Vercel empezarán a recibir 404 (el endpoint acepta cualquiera de los dos secretos de Vercel). Recuerda: tras rotar secretos Sensitive en Vercel hay que redesplegar; el despliegue en marcha conserva el valor viejo.

**No llegó el resumen de las 7:30.**

- Un día sin hábitos por hacer, tareas ni pagos **no manda nada** (queda `skipped`, `empty`).
- Un aviso se envía hasta 2 h después de su hora; pasada la ventana queda `skipped` (`window_expired`), incluso si conectaste el canal después.
- El tick corre cada ~15 minutos y GitHub puede retrasarlo. Los `schedule` solo corren en `main` y se pausan tras 60 días sin actividad en el repo; el cron diario de Vercel (`0 13 * * *`, ~8:00 Lima: en Hobby, entre 8:00 y 8:59) cubre el resumen de la mañana en ese caso.
- Un resumen vacío ya reclamado no se rehace: si a las 7:30 no había nada y añades algo a las 7:50, ese día no hay resumen.
- Un fallo ambiguo (timeout, error de red) **no se reintenta** a propósito: un aviso doble es peor que uno perdido.

**El workflow del tick falla con rojo.** Mira el paso «Tick»: `HTTP 404` (secreto distinto o ausente en Vercel), `HTTP 500` (revisa `reminders_tick_failed` en los logs) u otro código (revisa el estado de la app con el smoke).

## Cuando termines

- Avisa a Claude con «variables listas, redeploy hecho»: no le pases ningún valor.
- Claude recorre producción con el Chrome (datos `[QA]`), y tú haces la parte del iPhone: `tasks/todo.md` → «R6.2 Checkpoint final».
