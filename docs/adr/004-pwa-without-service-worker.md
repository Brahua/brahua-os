# ADR-004: PWA sin service worker hasta `reminders`

- **Estado:** aceptado (2026-09-29)
- **Tarea:** C7 de [`tasks/todo.md`](../../tasks/todo.md) · PR [#25](https://github.com/Brahua/brahua-os/pull/25)

## Contexto

El owner quiere instalar brahua-os en la pantalla de inicio del celular y abrirla como una app, sin la barra del navegador. Todas las pantallas, salvo `/login`, muestran datos personales y exigen sesión. Un service worker es la pieza habitual de una PWA, pero cachear HTML autenticado arriesga mostrar datos viejos o de una sesión cerrada, y agrega una capa de actualización (versiones, invalidación) difícil de depurar.

Los navegadores actuales (Chrome en Android, Safari en iOS 16.4+) ya permiten instalar una app con solo un manifiesto válido e íconos, sin service worker.

## Decisión

- La PWA de `core` es **solo** `src/app/manifest.ts` (`/manifest.webmanifest`, `display: "standalone"`) más los íconos de 192, 512 y *maskable*, el favicon y el `apple-icon`, y los metas de iOS (`metadata.appleWebApp`).
- **Sin service worker** y sin modo offline en `core`.
- El service worker llega con el módulo `reminders`, que lo necesita para las notificaciones push. En ese momento se decide (y se documenta en otro ADR) qué cachea, si es que cachea algo autenticado.

## Alternativas

- **`next-pwa` / Serwist con caché de páginas:** modo offline, pero con el riesgo de servir datos viejos o privados desde la caché y un ciclo de actualización más complejo, sin una necesidad concreta todavía.
- **Service worker vacío (solo para cumplir criterios de instalación):** ya no hace falta para instalar y agregaría una pieza sin función.

## Consecuencias

- La app instalada necesita conexión: sin red muestra el error del navegador.
- No hay caché que invalidar: cada despliegue se ve en la siguiente carga.
- Cambiar el ícono más adelante no se propaga solo en iOS: hay que borrar la app de la pantalla de inicio y volver a añadirla.
- `reminders` deberá revisar este ADR antes de agregar el service worker.
