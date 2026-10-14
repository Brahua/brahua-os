# Plan de implementación: finance-email

> Spec: [`SPEC-finance-email.md`](../../SPEC-finance-email.md) (APROBADO v1.0, 2026-10-14; addendum E5 aprobado el mismo día) · Tareas: [`finance-email-todo.md`](finance-email-todo.md)
> Planes anteriores en [`archive/`](archive/). **Cerrado el 2026-10-14** (E1–E6 más tres arreglos del primer uso real).

## Enfoque

Rebanadas verticales, **un implementador a la vez** (gate local liviano; los archivos de integración nuevos se corren de uno en uno): rama corta → PR a `main` → los 3 checks verdes verificados antes de cada merge → deploy y smoke. Cada agente hace push **una vez**. Revisión de seguridad obligatoria en E1 (ruta pública con secreto y entrada no confiable) y antes del cierre. El agente nunca ve el secreto: el owner lo genera y lo guarda en su terminal.

## Orden y dependencias

```
E1 Datos y endpoint ─┬─> E2 Parsers BCP/BBVA/Yape ─┐
                     └─> E3 Bandeja + Ajustes + E2E ─┴─> E4 Puesta en marcha y cierre
```

- **E1** migración aditiva (`finance_email_suggestions`, `finance_payment_methods.last4`, «Mis nombres»), `FINANCE_EMAIL_SECRET` en `env.ts`, la ruta con las validaciones en orden (secreto → tamaño → JSON → forma → relevancia → escribir), idempotencia por `gmail_message_id`, y el tipo `Reading` con un parser de juguete que fija el contrato para E2 y E3.
- **E2** parsers puros por formato (consumo BCP, consumo BBVA, pago Yape, transferencia a terceros BCP, Plin BBVA, interbancaria BBVA) con `parseSpanishDateTime` y el parser de montos; ignorados y «No pude leerlo». Fixtures anonimizados.
- **E3** sección «Sugerencias» en Finanzas, hoja de registrar, descartar y «Deshacer», marca «Posible duplicado» y «Remitente no verificado», campos «Mis nombres» y «Últimos 4 dígitos», y el único E2E.
- **E4** `docs/finance-email-setup.md` y el script de Apps Script de referencia (verificados contra el código y los límites de Google), secreto, Checkpoint en producción, retrospectiva, mapa, HANDOFF y archivo.

E2 y E3 pueden ir en paralelo tras E1 (contrato: la tabla y `Reading`); por la regla de un implementador a la vez se hacen en secuencia, y se mergea lo que quede verde primero.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un correo cambia de formato y el parser deja de leerlo | Un parser nunca lanza: devuelve `null` y la sugerencia queda «No pude leerlo» con «Registrar a mano»; fixtures por formato y un caso de cada ignorado. |
| Fechas y montos en cuatro formas (`S/ 20.00`, `43.20 PEN`, «12 octubre 2026 - 07:36 p. m.») | Tabla de casos unitaria con AM/PM, 24 h, meses capitalizados y medianoche de Lima; lo ambiguo (`1,000` vs `1.000`) se rechaza. |
| Correo falso que imita al banco | Nada se registra solo; remitente + asunto conocidos; marca «Remitente no verificado» si SPF/DKIM no es `pass`; revisión de seguridad. |
| Doble envío del script o doble toque en «Registrar» | `gmail_message_id` único con `ON CONFLICT DO NOTHING`; registrar en una transacción con lock; prueba con control positivo (dos ids distintos crean dos). |
| Contar dos veces (pago de tarjeta propia, pases a cuentas propias) | Se ignoran por asunto y por «Mis nombres»; casos en fixtures. |
| Datos reales en un repo público | Fixtures anonimizados; los correos reales solo en el scratchpad de la sesión y borrados después; el cuerpo del correo no se guarda ni se loguea. |
| Cuota de Apps Script (cada 5 min) | El script busca primero y solo llama si hay correos nuevos; se verifica el límite vigente en E4 y se documenta. |
| Fallo repetido del script manda muchos correos de error | Resumen de fallos en el disparador, documentado en la guía. |
| Presupuesto E2E y CI | Un solo spec nuevo; el resto unitario, de componente o de integración. |
| Navegación o pantallas de Finanzas cambian capturas | Dispatch de `update-screenshots.yml` justo tras el push de E3. |

## Checkpoints

- **Tras E1:** un POST de prueba con el secreto crea una fila, repetirlo no la duplica, y sin secreto se rechaza sin tocar la base de datos.
- **Tras E3:** el E2E pasa en CI: lote → sugerencia → registrar → gasto en el mes.
- **Checkpoint final (E4):** el owner instala el script y recorre en producción un correo real de cada formato (el agente verifica con el Chrome del owner lo que se pueda; datos `[QA]` que luego se borran). El iPhone queda para el owner.
