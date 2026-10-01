# ADR-005: Zona horaria

- **Estado:** aceptado (2026-09-30)
- **Tarea:** C3 de [`tasks/todo.md`](../../tasks/todo.md) · PR [#19](https://github.com/Brahua/brahua-os/pull/19)

## Contexto

El owner vive en Lima (`America/Lima`, UTC−5, sin horario de verano). El servidor (Vercel) corre en UTC y el navegador puede estar en cualquier zona si el owner viaja. Varios módulos futuros (`today`, `habits`, `reminders`) dependen de saber qué día es "hoy" para el owner: si se calcula con la zona del proceso, entre las 19:00 y la medianoche de Lima el servidor ya cree que es el día siguiente.

## Decisión

- **Almacenamiento:** todas las fechas con hora son `timestamptz`, en UTC (`created_at`, `updated_at`, `archived_at`…).
- **"Hoy" y todo lo que depende del día del owner** se calcula en `America/Lima` con los helpers de `src/lib/time.ts` (`OWNER_TIME_ZONE`, `ownerDateKey`, `ownerHour`, `greetingFor`, `formatLongDate`), que usan `Intl.DateTimeFormat` con `timeZone` explícito.
- **Cada helper recibe el instante** como argumento (`Date`), así nada depende de la zona del proceso y las pruebas pasan fechas fijas.
- En el servidor **nunca** se usa la zona del proceso (`new Date().getDate()`, `toLocaleDateString()` sin `timeZone`) para decidir el día.
- **Aritmética de fechas:** cuando haga falta (sumar días, inicio de semana), se agrega `@date-fns/tz` (`TZDate`). Todavía no hace falta.

## Alternativas

- **Usar la zona del navegador:** cambia si el owner viaja y no está disponible en el servidor al renderizar.
- **Fijar `TZ=America/Lima` en el proceso:** afecta todo el runtime de forma implícita, no aplica en todos los entornos (build, pruebas, CI) y esconde el supuesto.
- **Guardar fechas locales sin zona (`timestamp`):** pierde el instante real y complica cualquier cambio de zona futuro.

## Consecuencias

- La zona del owner es una constante del código. Si alguna vez cambia, se cambia en un solo lugar (`OWNER_TIME_ZONE`) y se convierte en una preferencia.
- Las pruebas de fechas (`tests/lib/time.test.ts`) usan instantes fijos, incluidos los de la noche de Lima, cuando en UTC ya es el día siguiente.
- Cómo se guarda una fecha "de día" sin hora (por ejemplo, el día de un hábito) lo decide la spec de cada módulo; `ownerDateKey` ya da la clave `YYYY-MM-DD` en hora de Lima.
