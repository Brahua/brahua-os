# Spec: finance-email (gastos desde correos)

> Extensión del módulo `finance` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `finance`, `reminders` (el tick y el patrón de webhook con secreto) y `core` · Estado: **APROBADO v1.0** (2026-10-14; el owner aprobó la spec y respondió todas las preguntas; las reglas salen de correos reales de su Gmail) · **Cerrado** el 2026-10-14 (probado por el owner en producción; E5 y E6 añadidos tras el primer uso real).

## Objetivo

Que los gastos que el banco ya me avisa por correo **lleguen solos a brahua-os como sugerencias**: veo el monto, la moneda, el comercio o detalle y la fecha, y los confirmo con un toque (o los descarto). Así registrar un gasto deja de depender de acordarme (principio: el costo de registrar es la causa del abandono).

Decisiones del owner (2026-10-14, respuestas a las preguntas del agente):

- **Ingesta:** un **Apps Script en mi Gmail** filtra los correos de mis bancos y los envía a un endpoint de brahua-os con un secreto. brahua-os no lee mi Gmail ni guarda credenciales de Google.
- **Revisión:** todo entra a una **bandeja de sugerencias**; nada se registra solo.
- **Lectura:** **reglas por banco** (una plantilla por remitente y formato). Sin IA.
- **Alcance:** **BCP y BBVA** (el owner no usa Scotiabank ni Interbank). Los pagos de Yape también llegan como correo propio y entran (ver «Formatos observados»).
- **Frecuencia del script:** cada 5 minutos (el script solo llama al endpoint si hay correos nuevos). Las transferencias recibidas se ignoran. El medio de pago se sugiere por banco y últimos 4 dígitos. Las sugerencias se ven solo en la sección de Finanzas (sin aviso en `reminders`).

Fuera de este módulo: leer el buzón completo, IA, ingresos y transferencias recibidas (`finance` no tiene ingresos), conciliación con estados de cuenta, adjuntos y PDFs, otros buzones que no sean Gmail, registrar sin confirmar, y escribir o responder correos.

### Respuesta corta a «¿es posible?»

Sí. Los bancos peruanos envían notificaciones de consumo y transferencia con monto, comercio y fecha en el cuerpo; eso se puede extraer con reglas. La parte frágil no es la ingesta sino **el formato de cada banco**, por eso las reglas se escriben contra correos reales (ver preguntas abiertas) y lo que no se entiende **no se descarta en silencio**: queda en la bandeja como «No pude leerlo» para que lo registre a mano.

### Supuestos (corríjanme ahora o sigo con estos)

1. Una sola cuenta de Gmail (la del owner) y un solo usuario en brahua-os.
2. Solo se interpretan **gastos salientes**: consumo con tarjeta (crédito o débito), pago de Yape y transferencias a terceros. Lo recibido y lo que mueve dinero entre cuentas propias se ignora sin mostrarlo.
3. La moneda sale del correo (PEN o USD); la fecha, del correo (si no trae, la del envío) en hora de Lima.
4. La categoría **no se adivina**: la elijo al confirmar (o queda la última usada, como en la captura). El medio se sugiere por banco + últimos 4 dígitos del correo, comparados con una nota/alias que el owner pone al medio en Ajustes («BCP ·6392»); sin coincidencia, el último usado.
5. Del correo se guarda **solo lo extraído** (monto, moneda, comercio, fecha, remitente, id del mensaje de Gmail). El cuerpo completo **no se guarda**.
6. El Apps Script corre cada 5 minutos con un disparador por tiempo y marca con una etiqueta de Gmail (`brahua-os/enviado`) lo ya enviado.

### Historias de usuario

1. Pago con la tarjeta; en unos minutos Finanzas muestra «1 sugerencia»: «S/ 45.90 · Rappi · hoy · BCP 1234». Toco «Registrar» y entra como gasto (con «Deshacer»).
2. Edito monto, categoría o medio antes de registrar, con la misma hoja del gasto.
3. Descarto una sugerencia («No es un gasto» / «Ya la tengo») con «Deshacer».
4. Si registré el gasto a mano antes, la sugerencia se marca «Posible duplicado» (mismo monto y moneda el mismo día) y no se registra sin que yo lo decida.
5. Llega un correo que no entiendo (formato nuevo): aparece «No pude leerlo · BCP · asunto…» con el botón «Registrar a mano» que abre la hoja vacía.
6. Reenvío el mismo correo o el script corre dos veces: **no** se duplica la sugerencia.
7. Un correo falso que imita al banco no puede registrar un gasto: solo crea una sugerencia que yo veo y decido.

## Formatos observados (correos reales del owner, 2026-10-14)

Leídos con el conector de Gmail del owner (autorizado por él); nada de esto se versiona con datos reales. Todos los remitentes llegan a `josuebh62@gmail.com` y la hora va en Lima.

| Formato | Remitente · asunto | Qué trae | Qué hace |
|---|---|---|---|
| **BCP consumo** (crédito y débito) | `notificaciones@notificacionesbcp.com.pe` · «Realizaste un consumo con tu Tarjeta de Crédito/Débito BCP» | «consumo de **$ 6.46** … en **PARAMOUNT+**», «Total del consumo», «Fecha y hora: 14 de octubre de 2026 - 12:10 AM», tarjeta `************6392`, «Empresa», «Número de operación» | **Sugerencia.** Moneda por `S/` o `$`. Crédito/débito sale del asunto. El débito por Plin llega como consumo con empresa `PLIN-<NOMBRE>` (también gasto). |
| **BBVA consumo** | `procesos@bbva.com.pe` · «Has realizado un consumo con tu tarjeta BBVA» | `Comercio: RAPPI SAC`, `Monto: 43.20`, `Moneda: PEN`, `Fecha: 11/10/2026`, `Hora: 14:52:43`, «tarjeta terminada en *3659» | **Sugerencia.** El monto no lleva símbolo: la moneda sale de «Moneda:». |
| **Yape pago** | `notificaciones@yape.pe` · «Pago exitoso» | «Tu pago en **L1 MAX** fue exitoso», «Monto total S/ 49.90», «Fecha y hora: 12 octubre 2026 - 07:36 p. m.», «ID de operación» | **Sugerencia.** Hora con «p. m.»; el monto puede venir pegado («S/49.90»). |
| **Yape yapeo** | `notificaciones@yape.pe` · «Por tu seguridad, te notificaremos por cada yapeo que realices» | «Monto de yapeo S/ 33.00», «Fecha y Hora de la operación 19 octubre 2026 - 01:56 p. m.», «Nombre del Beneficiario Ricardo Cer*» (apellido enmascarado), «Nº de operación» | **Sugerencia** (transferencia a esa persona). El texto plano trae asteriscos y todo en una línea. No es gasto: «Cambios en monto de yapeo alto» (aviso de configuración) sigue sin reconocerse. |
| **BCP transferencia a terceros** | `notificaciones@notificacionesbcp.com.pe` · «Constancia de Transferencia a Terceros BCP» | «transferencia de **S/ 400.00** desde tu Clasica», «Enviado a <nombre>», fecha larga con «Octubre» capitalizado | **Sugerencia** con detalle «Transferencia a <nombre>» (el destinatario puede ser una persona; lo decide el owner). |
| **BBVA Plin enviado** | `procesos@bbva.com.pe` · «Constancia de operación transferencia PLIN» (y «… con QR») | «Plineaste **S/ 50.00** a <nombre>», fecha «3 de octubre, 2026 …», «Pago con QR» en algunos | **Sugerencia** (pago/transferencia). Si el nombre es el del owner, se ignora (pase a su propio Yape). |
| **BBVA transferencia interbancaria** | `procesos@bbva.com.pe` · «BBVA - Constancia Transf. Interbancaria» | «Importe transferido S/ 1000.00», «Nombre del beneficiario» y «Titular de la cuenta», «Fecha y hora: 04 octubre, 2026 09:51» | Si beneficiario = titular («Esta cuenta es propia»): **se ignora**. Si no: sugerencia. |

**Se ignoran** (no son gasto o ya se cuentan en otro correo): «Constancia Pago de Tarjetas propias» (BBVA) y «Constancia de Pago de Tarjeta de Crédito Propia» (BCP) porque ese dinero ya salió en cada consumo y contarlo duplicaría el gasto; «Transf. a ctas. propias»; «Paga tus consumos con puntos»; estados de cuenta; comprobantes electrónicos; y todo lo promocional (`bcpcomunica@…`, `novedadesyape.pe`). El filtro es por remitente exacto **y** asunto conocido; lo demás no sale del Gmail del owner.

**Hallazgos que cambian el diseño**

1. **Montos:** `S/ 20.00`, `$ 6.46`, `S/49.90`, `43.20 … PEN`, `S/ 10378.20` (sin separador de miles). El parser acepta además `1,000.50` y `1.000,50` y rechaza lo ambiguo (→ ilegible).
2. **Fechas en cuatro formas:** «14 de octubre de 2026 - 12:10 AM», `11/10/2026`, «12 octubre 2026 - 07:36 p. m.», «04 octubre, 2026 09:51» (meses en español, a veces capitalizados; AM/PM y 24 h). Una función `parseSpanishDateTime` con casos de prueba para cada una.
3. **Comercios crudos:** `IZI*MR CHORI`, `DLC*helphbomaxcom`, `OPENAI *CHATGPT SUBSCR.`, `PLIN-KATITA SALDANA`. En v1 se muestran tal cual (y se limpia solo el prefijo `PLIN-`); un mapa «comercio → categoría» aprendido de lo que el owner registra queda en el backlog.
4. **Duplicados entre bancos:** no apareció un doble aviso para el mismo pago (el débito BCP por Plin y el Plin de BBVA son de bancos distintos). La marca «Posible duplicado» (mismo monto, moneda y día) sigue valiendo.
5. **El nombre del owner aparece** en «Plineaste … a <nombre>» y en «Titular»/«Beneficiario»: la regla «a cuenta propia» compara contra los nombres propios que el owner guarda en Ajustes (no hardcodeados en el código ni en el repo).
6. **Medios por tarjeta:** BCP crédito `…6392`, BCP débito `…3448`, BBVA `…3659`: los últimos 4 dígitos alcanzan para sugerir el medio.
7. **Cuerpos largos y con enlaces de rastreo:** el correo plano trae textos legales y URLs de SendGrid/awstrack; el script manda solo el texto plano recortado (≤ 8 KB por correo) y el parser nunca sigue enlaces.

## Decisiones

| Tema | Decisión | Origen |
|---|---|---|
| Endpoint | `POST /api/finance/email-ingest` (Node, `maxDuration` corto, `force-dynamic`). Orden de la lección de `reminders`: secreto (cabecera, comparación en tiempo constante) → tamaño (≤ 128 KB por lote (hasta 10 correos)) → JSON → forma (Zod) → relevancia (remitente permitido) → y solo entonces escribir. | Lecciones de `reminders` |
| Secreto | Variable `FINANCE_EMAIL_SECRET` (≥ 32 caracteres, validada en `env.ts` por nombre, nunca impresa). El owner la genera y la guarda en su terminal (`openssl rand … \| vercel env add … --sensitive`) y la pega en las propiedades del script de Google. El agente no la ve. | Lecciones de `core` y `reminders` |
| Remitentes | Lista **fija en código** por parser (`bcp`, `bbva`, `yape`). El script también filtra por remitente en Gmail, pero el servidor **no confía** en eso. | Defensa en profundidad |
| Autenticidad | El script envía además el resultado SPF/DKIM de Gmail si lo expone (cabecera `Authentication-Results`); si no es `pass`, la sugerencia entra marcada «Remitente no verificado» y sin botón directo de «Registrar» (hay que abrir la hoja). Como nada se registra solo, un correo falso nunca crea un gasto. | Seguridad; revisor de seguridad obligatorio |
| Idempotencia | Clave única `(gmail_message_id)`; `INSERT … ON CONFLICT DO NOTHING` antes de interpretar. Reprocesar un mensaje no cambia lo ya decidido. | Lección «una reclamación por…» de `reminders` |
| Tabla | `finance_email_suggestions`: `id`, `gmail_message_id` (único), `source` (`bcp`/`bbva`/`yape`), `kind` (`card`/`yape`/`transfer`), `card_last4`, `status` (`pending`/`registered`/`dismissed`/`unreadable`), `amount_cents`, `currency`, `merchant` (≤ 80), `occurred_on` (fecha Lima), `method_hint`, `subject` (≤ 120, recortado), `sender_verified` (bool), `expense_id` (FK, null hasta registrar), `created_at`, `decided_at`. Migración **aditiva**. | Convención de `finance` |
| Registrar | Acción `ownerAction(schema, handler)` que, en una transacción y bajo el lock de la sugerencia, crea el gasto con `insertExpense` y pasa la sugerencia a `registered` con su `expense_id`. «Deshacer» lleva `suggestionId` + `expenseId` y solo borra (lógico) si el gasto sigue igual. | Lección «Undo targets the exact row» (`finance`) |
| Dinero | Enteros en centavos con el parser de `money.ts`; nunca flotantes. Montos con coma o punto de miles se normalizan por regla del banco y se prueban con casos reales. | Lecciones de `finance` |
| Duplicado | «Posible duplicado» si hay un gasto no eliminado con el mismo monto, moneda y día de Lima. Es una marca, no un bloqueo. | Recomendación del agente |
| Retención | Las sugerencias decididas se conservan 90 días y se limpian en el tick (nunca el gasto). Las `pending` no caducan. | Recomendación del agente |
| Sin culpa | Copy neutro («Sugerencias», «Registrar», «Descartar»); sin contadores de deuda ni rojo. | Principios UX 7 y 8 |
| Navegación | Sin ruta nueva: sección «Sugerencias» arriba de Finanzas (solo si hay). | Reutilizar contratos |
| Aviso | Ninguno: las sugerencias solo se ven en la sección de Finanzas (decisión del owner, 2026-10-14). | Owner |

## Tech stack

Next.js (App Router, versión del repo: leer `node_modules/next/dist/docs/` antes de tocar rutas), TypeScript, Drizzle + Postgres (Neon), Zod. **Sin dependencias nuevas** (el parser son funciones puras con expresiones regulares). El Apps Script vive **fuera de la app** (en la cuenta de Google del owner); su código de referencia se versiona en `docs/finance-email-apps-script.js` sin ningún secreto.

## Comandos

```
Dev:          nvm use && pnpm dev
Lint:         pnpm exec eslint <archivos>
Formato:      pnpm exec prettier --check .
Tipos:        pnpm typecheck
Unitarias:    rtk proxy pnpm vitest run --maxWorkers=2 <archivos tocados>
Integración:  rtk proxy pnpm test:integration <archivo nuevo>   # una a la vez; luego pnpm db:test:stop y borrar .pgdata
Migración:    pnpm db:generate   # y correr Prettier sobre drizzle/meta/*_snapshot.json
```

Lo pesado (build, suite completa, integración total, E2E, axe, capturas) lo valida **CI** (regla del gate local liviano).

## Estructura del proyecto

```
src/modules/finance/email/
  parsers/<banco>.ts       → una función pura por banco: (mensaje) => Lectura | null
  parsers/index.ts         → elige el parser por remitente
  ingest.ts                → valida, reclama el mensaje, interpreta y escribe
  suggestions.ts           → consultas y marca de duplicado
  actions.ts               → registrar / descartar / deshacer (ownerAction)
  email-copy.ts            → textos en español
src/modules/finance/db/schema.ts   → tabla finance_email_suggestions (aditiva)
src/app/api/finance/email-ingest/route.ts
src/modules/finance/components/    → sección «Sugerencias» y su hoja
tests/finance/email/       → unitarias de parsers con fixtures anonimizados
tests/integration/         → ingesta idempotente y «Deshacer»
e2e/finance-email.spec.ts  → UN solo E2E (presupuesto del corte)
docs/finance-email-setup.md y docs/finance-email-apps-script.js
```

## Estilo de código

Mismo que el repo: módulos pequeños, inglés en código y español en copy, validación con Zod, errores sin valores de entrada (`describeError`). Un parser es una función pura y testeable:

```ts
export function parseBcpConsumption(message: EmailMessage): Reading | null {
  const body = normalize(message.text);
  const match = /consumo.*?(S\/|US\$)\s?([\d.,]+).*?en\s+(.+?)\s+el\s+(\d{2}\/\d{2}\/\d{4})/is.exec(body);
  if (!match) return null; // never throw: "null" means "unreadable", and it is shown as such
  return { amountCents: toCents(match[2]), currency: match[1] === "S/" ? "PEN" : "USD", merchant: match[3].trim(), occurredOn: toLimaDate(match[4]) };
}
```

## Estrategia de pruebas

- **Unitarias (grueso de la cobertura):** cada parser contra fixtures **anonimizados** (montos y comercios inventados con el mismo formato), incluidos los casos feos: miles con coma/punto, USD, comercio con tildes o `&amp;`, HTML en vez de texto, correo de «transferencia recibida» (debe ignorarse), correo desconocido (debe dar `unreadable`).
- **Componente:** la sección «Sugerencias» (registrar, descartar, deshacer, duplicado, no verificado) con foco restaurado y `aria-disabled` mientras guarda.
- **Integración (una por archivo):** idempotencia por `gmail_message_id` con control positivo (dos ids distintos crean dos), carrera de dos lotes a la vez, «Deshacer» exacto y límites de tamaño/secreto del endpoint.
- **E2E:** **una** spec nueva (`e2e/finance-email.spec.ts`, con su entrada en `SPEC_MODULES`): publicar un lote al endpoint de prueba, ver la sugerencia, registrar y comprobar el gasto en el mes.
- **Revisión de seguridad** obligatoria antes del merge (ruta pública con secreto, entrada no confiable, correos suplantados).
- **Fixtures reales:** los correos reales del owner viven en el scratchpad de la sesión (nunca en el repo, que es público hasta ~2026-11-01) y se borran después; solo se versionan copias anonimizadas.

## Límites

- **Siempre:** `ownerAction`/`requireOwner`; secreto antes de leer el cuerpo; límite de tamaño; ids deterministas e idempotencia; centavos enteros; el cuerpo del correo no se guarda ni se loguea; foco restaurado; copy sin culpa; una sola E2E.
- **Preguntar primero:** leer correos reales del buzón del owner (aunque sea para escribir las reglas), dependencias nuevas, IA, registrar sin confirmar, cualquier cambio destructivo en producción, dar permisos de Gmail a algo que no sea el script del owner.
- **Nunca:** pedir o imprimir el secreto en la sesión, guardar tokens de Google en brahua-os, versionar correos o montos reales, registrar un gasto desde un correo sin la confirmación del owner, confiar en el remitente que dice el cuerpo, seguir enlaces del correo desde el servidor.

## Criterios de éxito

1. Un lote con un correo de consumo de cada banco del alcance crea una sugerencia con monto, moneda, comercio y fecha correctos (pruebas con fixtures).
2. Reenviar el mismo lote 3 veces deja **una** sugerencia por mensaje; dos mensajes distintos con el mismo monto dejan dos.
3. Un correo de transferencia recibida, de pago de tarjeta propia o entre cuentas propias no crea sugerencia; uno ilegible crea «No pude leerlo» y no rompe el lote.
4. Registrar crea exactamente un gasto (en el mes correcto, en Lima) y «Deshacer» lo revierte sin tocar uno posterior.
5. Una petición sin secreto, con secreto equivocado o de más de 128 KB se rechaza **antes** de tocar la base de datos.
6. Desde que llega el correo hasta verlo en la bandeja pasa ≤ 6 min (disparador de 5 min), y registrar toma ≤ 2 toques en el celular.
7. El owner recorre en producción un correo real de cada formato y confirma que lo leído coincide (Checkpoint).

## Plan de cortes (para aprobar; después `tasks/plan.md` y `tasks/todo.md`)

| Corte | Contenido | Depende de |
|---|---|---|
| **E1** Datos y endpoint | Migración aditiva, `env.ts`, ruta con las 5 validaciones en orden, idempotencia, parser «de juguete» y pruebas de integración. | `finance` |
| **E2** Parsers por banco | BCP, BBVA y Yape con fixtures anonimizados; ilegibles y recibidos. | E1 (los correos de ejemplo ya se leyeron) |
| **E3** Bandeja | Sección «Sugerencias», hoja de registrar, descartar, «Deshacer», duplicado, no verificado; la E2E. | E1 |
| **E4** Puesta en marcha | `docs/finance-email-setup.md` (verificado contra el código), script de Google de referencia, secreto, Checkpoint en producción con el Chrome del owner. | E2, E3 |

E2 y E3 pueden ir en paralelo tras E1 (contrato: la tabla y el tipo `Reading`); merge en el orden en que queden verdes.

## Preguntas resueltas (2026-10-14)

1. Correos de ejemplo: el owner autorizó leer su Gmail; se usaron los formatos de arriba.
2. Solo BCP y BBVA (sin Scotiabank ni Interbank).
3. Transferencias **recibidas**: se ignoran.
4. El medio se sugiere por banco + últimos 4 dígitos.
5. El script corre cada 5 minutos (decisión posterior del owner, 2026-10-14; los límites de cuota de Apps Script se verifican contra la documentación en E4).
6. Las sugerencias solo se ven en la sección de Finanzas.

## Preguntas resueltas después (2026-10-14)

- Transferencias a terceros: **entran como sugerencia**.
- «Mis nombres» en Finanzas → Ajustes: **sí** (campo para detectar pases a cuentas propias).
- «Últimos 4 dígitos» en cada medio de pago: **sí** (migración aditiva).

## Preguntas abiertas

Ninguna. Falta la aprobación del owner para pasar al plan (`tasks/plan.md`, `tasks/todo.md`).

## Addendum E5: pagos recurrentes que llegan por correo (APROBADO, 2026-10-14)

Origen: el primer uso real (el owner, 2026-10-14). Los pagos recurrentes (Netflix, Spotify, ChatGPT…) también avisan por correo, así que aparecen como sugerencias de gasto suelto y habría que registrarlos aparte de su período pendiente en «Pagos». Decisiones del owner, mismo día:

- **Un toque para confirmar** (no se marca solo): la sugerencia dice «Parece el pago de «Netflix»» y su tecla principal es **«Marcar como pagado»**.
- **Reconocer por nombre y monto, y aprender:** la primera vez que el owner confirma un pago, la app recuerda el comercio del correo para ese pago recurrente; la siguiente vez lo propone por ese comercio aunque cambie el monto.
- **Período ya pagado:** si el owner ya lo marcó a mano, la sugerencia queda con la nota «Ya marcaste «Netflix» como pagado este mes» y **«Descartar»** como tecla principal.

### Reglas

1. **Candidatos:** pagos recurrentes activos y no eliminados, con la misma **moneda** que la sugerencia. Un pago con otra moneda nunca coincide.
2. **Coincidencia** (se evalúa en el servidor, nunca se confía en el cliente), en este orden:
   a. **Alias aprendido:** el comercio normalizado de la sugerencia es uno de los alias del pago.
   b. **Nombre + monto:** todas las palabras del nombre del pago (≥ 3 letras, sin tildes ni mayúsculas) están en el comercio normalizado **y** el monto es igual al previsto (o el pago es de monto variable).
   c. **Solo nombre:** las mismas palabras, pero el monto difiere: se propone igual con la nota «El monto es distinto del previsto (S/ 50.00)»; al marcar, queda el monto **real** del correo.
   Con varios candidatos gana el de mayor regla (a > b > c); con empate de regla gana el nombre que dice más (más palabras: «Netflix Premium» sobre «Netflix»); si eso tampoco separa, ninguno (sigue como gasto suelto: nunca se adivina entre dos).
3. **Período:** el más antiguo **pendiente** de ese pago (la misma lista que «Pendientes»). Si no hay pendiente pero el período de este mes ya está pagado, estado «Ya pagado».
4. **Marcar como pagado** = el «Pagado» de Pagos (`payPeriod`) con el monto, el día de Lima del correo (nunca después de hoy) y el medio que sugieren los 4 dígitos (si no, el del pago). Mismo gasto con `recurring_payment_id` y `recurring_due_on`, misma regla de última cuota (archiva). La sugerencia pasa a `registered` con ese gasto.
5. **Aprender:** al marcar, el comercio normalizado se añade a los alias del pago (máx. 10; el más viejo sale). No se aprende al descartar ni al registrar como gasto suelto (esa es la forma de decir «no es ese pago»; ver 7).
6. **Deshacer:** quita el gasto y libera el período exacto (`undoPaidPeriod`, con el sello si la última cuota archivó el pago); el alias aprendido **se conserva** (decisión autónoma: si el owner deshace por error de toque, el reconocimiento sigue valiendo; se quita editando el pago, backlog).
7. **«Registrar como gasto»** sigue disponible en la misma fila (el gasto suelto de siempre).
8. **Remitente no verificado:** igual que antes, sin toque directo (se revisa en la hoja, que registra como gasto suelto).

### Datos y pantallas

- Migración aditiva: `finance_recurring_payments.email_aliases text[] not null default '{}'` (CHECK: ≤ 10 elementos, cada uno ≤ 80). Exportada con el resto.
- `SuggestionItem.recurring`: `{ id, name, dueOn, state: "pending" | "paid", sameAmount, expectedCents }` o `null`.
- Fila: la línea «Parece el pago de «Netflix» · vence el 8 de octubre» (o «venció el …», sin la palabra «atrasado»), teclas «Marcar como pagado» · «Registrar como gasto» · «Descartar». Estado «Ya pagado»: nota + «Descartar» (principal) · «Registrar como gasto».
- Acciones: `markSuggestionPaid({ id })` y su «Deshacer» (`undoMarkSuggestionPaid({ id, expenseId, reopenStamp })`).

### Bloqueos

Los candados advisory van **antes** que cualquier candado de fila: se lee la sugerencia y se calcula la coincidencia sin candados, luego se toman `(5000, hashtext('finance:email:<id>'))` y el del pago recurrente, y recién después se bloquea la fila de la sugerencia y se revalida (si cambió la coincidencia, «cambió mientras tanto»).

### Criterios de éxito

1. Un correo de Netflix de S/ 50.00 con «Netflix» pendiente propone «Marcar como pagado»; un toque marca el período con ese monto, el día del correo y su medio, y «Deshacer» lo deja pendiente otra vez.
2. Un cobro de otro monto de un pago con el comercio ya aprendido se propone igual; sin alias ni nombre, no.
3. Con dos pagos que coinciden por igual no se propone ninguno.
4. Un período ya pagado a mano muestra «Ya pagado» y nunca crea un segundo gasto.
5. Dos toques o dos pestañas dejan un solo gasto y un solo período pagado.
6. Un pago en otra moneda nunca coincide.

### Corte E5 (≈ M)

Migración y `recurring-match.ts` puro (normalizar, reglas a/b/c, desempate), `markSuggestionPaid` con candados y su «Deshacer», fila nueva y copy, aprendizaje de alias; pruebas unitarias del reconocedor, de integración (pagar, deshacer, doble toque, otra moneda, empate, ya pagado, última cuota) y de componente. **Sin E2E nueva** (presupuesto): se amplía la existente solo si cabe sin una pantalla nueva; si no, solo unitarias e integración.
