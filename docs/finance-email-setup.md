# Puesta en marcha de «gastos desde correos» (guía del owner)

> Para el owner. Todo lo que lleva un secreto se hace **en tu propia terminal** (Terminal.app o iTerm), nunca en la sesión de Claude: los secretos no se pegan ahí, y el prefijo `!` de la sesión guarda los secretos **vacíos**.
> Verificada contra el código el 2026-10-14: `src/modules/finance/email/{env,ingest,constants}.ts`, `src/modules/finance/email/parsers/index.ts`, `src/app/api/finance/email-ingest/route.ts`, `docs/finance-email-apps-script.js` y `.github/workflows/ci.yml`. Los límites de Apps Script se leyeron de la documentación de Google el mismo día (cambian sin aviso: ante un error de cuota, vuelve a mirarlos).

## Qué vas a dejar funcionando

Un script de Google, **en tu cuenta**, que cada 5 minutos busca en tu Gmail los correos nuevos de **BCP, BBVA y Yape** y los manda a brahua-os. Finanzas los muestra arriba como **Sugerencias** (monto, comercio, día y medio de pago); tú decides con un toque. Nada se registra solo.

```
Gmail ──(script de Google, cada 5 min)──> POST /api/finance/email-ingest ──> Sugerencias en Finanzas
```

brahua-os **no lee tu Gmail** y no guarda credenciales de Google: solo recibe, con un secreto, los correos de esos tres remitentes. De cada correo guarda lo que entendió (monto, moneda, comercio, día, últimos 4 dígitos, el asunto y quién lo envió), **nunca el cuerpo**.

Sin la variable `FINANCE_EMAIL_SECRET` la app no se rompe: el endpoint responde 404 a todo.

## Qué correos entiende

| Correo | Qué hace |
| --- | --- |
| BCP · consumo con tarjeta de crédito o débito | Sugerencia. Un pago por Plin con débito (`PLIN-NOMBRE`) sale como transferencia a esa persona. |
| BCP · transferencia a terceros | Sugerencia («Transferencia a …»). |
| BBVA · consumo con tarjeta | Sugerencia. |
| BBVA · Plin enviado (también con QR) | Sugerencia; si el nombre es el tuyo («Mis nombres») se ignora. |
| BBVA · transferencia interbancaria | Sugerencia; se ignora si es a una cuenta tuya. |
| Yape · pago exitoso | Sugerencia. |
| Yape · yapeo a una persona («Por tu seguridad, te notificaremos por cada yapeo que realices») | Sugerencia como transferencia al beneficiario (Yape enmascara el apellido: «Ricardo Cer*»). |
| Pago de tu propia tarjeta (BCP y BBVA), transferencia entre cuentas propias, puntos BBVA | Se ignoran: ese dinero ya salió en cada consumo. |
| Estados de cuenta, comprobantes, promociones, lo recibido | No salen de tu Gmail: el script solo mira a los tres remitentes y la app solo reconoce los asuntos de arriba. |

Un correo de esos remitentes con un formato que la app no conoce aparece como **«No pude leerlo»**, con «Registrar a mano».

## Antes de empezar

```bash
cd ~/dev/projects/brahua-os
nvm use                       # Node 24 (.nvmrc)
gh api user -q .login         # debe decir: Brahua
vercel whoami                 # tu cuenta de Vercel (proyecto brahua-os, equipo Brahua Lab)
```

Si `gh` dice `jbrahua`: `env -u GH_TOKEN gh auth switch -h github.com -u Brahua`.

## Paso 1. El código en tu cuenta de Google

1. Entra a https://script.google.com con la cuenta de Gmail **donde llegan los correos del banco** y toca **Nuevo proyecto**. Ponle de nombre «brahua-os · gastos».
2. Copia el script y pégalo en el editor, reemplazando el código de ejemplo:

   ```bash
   cat ~/dev/projects/brahua-os/docs/finance-email-apps-script.js | pbcopy
   ```

   Guarda (⌘S). **No lo ejecutes todavía.** El archivo no lleva ningún secreto.

## Paso 2. El secreto (el mismo en Vercel y en el script)

Se genera una vez. Vercel no deja leer de vuelta una variable Sensitive, así que el valor se copia al portapapeles al crearla (esto **reemplaza** lo que copiaste en el paso 1, que ya está pegado).

```bash
SECRET="$(openssl rand -hex 32)"
printf %s "$SECRET" | vercel env add FINANCE_EMAIL_SECRET production --sensitive
printf %s "$SECRET" | pbcopy
unset SECRET
```

Si la variable ya existe, añade `--force` al comando de Vercel para reemplazarla. Comprobar que está (muestra el nombre, no el valor):

```bash
vercel env ls production | grep FINANCE_EMAIL_SECRET
```

Ahora, en el editor del script: **Configuración del proyecto** (el engranaje) → **Propiedades del script** → **Agregar propiedad del script**, dos veces:

| Propiedad | Valor |
| --- | --- |
| `FINANCE_EMAIL_URL` | `https://os.brahua.com/api/finance/email-ingest` |
| `FINANCE_EMAIL_SECRET` | pega el secreto del portapapeles (64 caracteres) |

Guarda las propiedades y **vacía el portapapeles**: `pbcopy < /dev/null`. No pegues el secreto en ningún chat, nota ni mensaje.

## Paso 3. Redeploy de producción

Las variables nuevas **no llegan a un despliegue ya hecho**. El único que despliega es el job `deploy` de `ci.yml` (solo en `push` a `main`). Vuelve a correr el deploy del último push a `main` (no repite los tests):

```bash
RUN="$(gh run list --repo Brahua/brahua-os --workflow ci.yml --branch main --event push --status success --limit 1 --json databaseId -q '.[0].databaseId')"
JOB="$(gh run view "$RUN" --repo Brahua/brahua-os --json jobs -q '.jobs[] | select(.name=="Deploy to production") | .databaseId')"
gh run rerun "$RUN" --repo Brahua/brahua-os --job "$JOB"
gh run watch "$RUN" --repo Brahua/brahua-os
```

El `smoke` corre solo después. (O espera al siguiente merge a `main`: despliega con la variable.)

## Paso 4. Activar el script

1. En el editor, elige la función **`install`** en el selector de arriba y toca **Ejecutar**. La primera vez Google pide permisos (ver «Permisos»). `install` guarda desde cuándo mirar (los últimos 2 días) y crea el disparador de cada 5 minutos.
2. En **Activadores** (el reloj) comprueba que hay uno: función `run`, «Según el tiempo», «Cada 5 minutos». Toca el **lápiz** (editar) de esa fila → **Configuración de notificaciones de falla**, déjalo en **«Notifícame una vez por hora»** (o cada día) (si el secreto estuviera mal, un aviso inmediato te mandaría un correo cada 5 minutos).

### Permisos

Google mostrará «Google no ha verificado esta aplicación»: es **tu propio script**, no una app publicada. Toca **Configuración avanzada → Ir a brahua-os · gastos (no seguro)** y acepta. Pide dos permisos:

- **Gmail** (`https://mail.google.com/`): es el único permiso que existe para `GmailApp`, y por eso Google lo describe como «leer, redactar, enviar y eliminar»; **este script solo lee** (`GmailApp.search`, `getMessages`, `getPlainBody`…): no envía, no borra ni etiqueta nada. Léelo: es un archivo corto, sin dependencias.
- **Conectarse a un servicio externo** (`UrlFetchApp`): para mandar los correos a `os.brahua.com`.

## Paso 5. Ajustes en la app

1. **Finanzas → Ajustes → Correos del banco → «Últimos 4 dígitos»**: para cada medio de pago con tarjeta, los 4 dígitos que aparecen en el correo (BCP: «Número de Tarjeta» `************NNNN`; BBVA: «tarjeta terminada en `*NNNN`»). Con eso la sugerencia trae el medio de pago ya elegido.
2. **«Mis nombres»**, uno por línea, como te llama el banco («Nombre Segundo Apellido Apellido»). Sirven para ignorar las transferencias a tus propias cuentas; también reconoce abreviaturas («Nombre S Apellido A»).

## Paso 6. Comprobar que funciona

1. En el editor del script, elige **`run`** y toca **Ejecutar**; abre **Ejecuciones** y mira que terminó sin error.
2. En https://os.brahua.com/finance debe aparecer **Sugerencias** con los correos de los últimos 2 días (si hubo alguno).
3. Haz un gasto con la tarjeta; en menos de 6 minutos debe llegar una sugerencia nueva. Toca **Registrar** y comprueba el gasto en el mes; **Deshacer** lo quita.
4. Si una sugerencia dice «Remitente no verificado», Gmail no pudo comprobar de quién era el correo: **Revisar** abre la hoja en lugar de registrar de un toque. Si pasa con correos legítimos del banco de forma habitual, dímelo: se ajusta cómo el script lee `Authentication-Results`.

## Pagos recurrentes (Netflix, Spotify…)

Si el cobro parece un pago recurrente tuyo (por el nombre y el monto, o por un comercio que ya confirmaste antes), la sugerencia dice **«Parece el pago de «Netflix» · vence el 8 de octubre»** y su tecla principal es **Marcar como pagado**: marca ese período en Pagos con el monto, el día y la tarjeta reales del correo. «Registrar como gasto» lo deja como gasto suelto (y el pago sigue pendiente). La primera vez que confirmas uno, la app recuerda el comercio del correo («EBN*SPOTIFY» → Spotify) y la siguiente lo reconoce aunque cambie el monto. Si ya habías marcado el pago a mano, la sugerencia dice «Ya marcaste … como pagado este mes» y solo hay que **Descartar**; y si el monto que registraste no es el que cobró el banco (un impuesto que varía), dice «Registraste USD 6.00; el banco cobró USD 6.46» y la tecla **Corregir a USD 6.46** cambia el monto de ese gasto (con «Deshacer»). Con dos pagos que podrían ser el mismo cobro, no propone ninguno. «Deshacer» deja el período pendiente otra vez.

## Límites de Google (cuentas personales, leídos el 2026-10-14)

| Límite | Valor | Tu uso |
| --- | --- | --- |
| Tiempo total de activadores | 90 min/día | cada 5 min son 288 ejecuciones; una sin correos nuevos dura menos de 1 s: ~5 min/día |
| Duración de una ejecución | 6 min | segundos |
| Activadores por script | 20 | 1 |
| Llamadas `UrlFetch` | 20 000/día | solo cuando hay correos nuevos: unas pocas al día |
| Lectura de correo | 20 000/día | una búsqueda por ejecución |
| Una propiedad del script | 9 KB | el secreto y la URL |

Si Google pausa el script por cuota, el correo sigue en tu Gmail y la siguiente ejecución lo manda.

## Qué hace el script con los errores

- **404:** la URL o el secreto no son los de la app. El script falla y se reintenta en 5 minutos; ve a «Resolución de problemas».
- **400 o 413 en un lote:** lo manda de uno en uno y **omite** el correo que la app siga rechazando (queda un aviso en el registro de ejecuciones); los demás pasan.
- **500 u otro:** falla y reintenta. Como la app no duplica por correo, reintentar es seguro.
- Si algo falla, el script **no avanza** su marca de tiempo: no se pierde ningún correo.

## Volver a leer correos

Si una regla nueva entiende un formato que antes era «No pude leerlo» (o quieres revisar más atrás), ejecuta **`resendWeek`** desde el editor (vuelve a mandar la última semana; para otro plazo, cambia el número de `resendWeek`). Los correos que eran ilegibles pasan a sugerencia **una vez**; lo que ya registraste o descartaste no cambia.

## Rotar el secreto o desinstalar

- **Rotar:** repite el paso 2 con `--force`, el paso 3 y cambia la propiedad `FINANCE_EMAIL_SECRET` del script. Entre un paso y otro el script recibe 404 y reintenta: no pierde nada.
- **Pausar:** en el editor, ejecuta `uninstall` (quita el disparador). `install` lo vuelve a crear y mira los últimos 2 días.

## Resolución de problemas

- **No aparece ninguna sugerencia.** Mira **Ejecuciones** del script: si hay errores, el mensaje dice qué (404: URL o secreto; 5xx: la app). Si no hay errores, comprueba que el correo viene de uno de los tres remitentes (BCP `notificaciones@notificacionesbcp.com.pe`, BBVA `procesos@bbva.com.pe`, Yape `notificaciones@yape.pe`) y que el asunto es uno de la tabla de arriba.
- **«brahua-os respondió 404».** `FINANCE_EMAIL_URL` mal escrita, o el secreto distinto del de Vercel, o falta el redeploy del paso 3 (la variable no llega a un despliegue ya hecho).
- **Una sugerencia sale con el monto o el comercio mal.** Pásame el correo (con los datos tapados) para ajustar la regla.
- **Una transferencia a mi propia cuenta salió como sugerencia.** Falta ese nombre en «Mis nombres».
- **Un gasto salió dos veces.** La app no duplica por correo; si ya lo habías registrado a mano, la sugerencia dice «Posible duplicado»: descártala.
