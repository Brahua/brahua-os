# Tareas: core

> Plan: [`tasks/plan.md`](plan.md) · Spec: [`SPEC-core.md`](../SPEC-core.md)
> Cada tarea termina con `pnpm lint && pnpm typecheck && pnpm test` (y `pnpm test:e2e` si toca UI) en verde, un PR con el CI verde y el merge, que **publica en producción**. Commits en inglés (`feat(core): …`).
> Las pruebas nunca apuntan a la base de producción.

## Fase 0 — Producción desde el día 1

- [x] **C0: Despliegue en `os.brahua.com`** *(requiere tu participación)*
  - **Qué:**
    - [x] Proyecto `brahua-os` en Vercel (equipo Brahua Lab), enlazado al repo.
    - [x] Auto-deploy de Vercel desactivado: despliega el job `deploy` de GitHub Actions, solo con todos los checks en verde.
    - [x] Base Neon `brahua-os-db` desde Vercel Marketplace, con las variables solo en producción.
    - [x] Dominio `os.brahua.com` agregado en Vercel.
    - [x] Registro `A os → 76.76.21.21` en Hostinger.
    - [x] Secreto `VERCEL_TOKEN` (scope Brahua Lab) en GitHub. Primer despliegue exitoso el 2026-09-30.
    - Mientras no haya login, la app pública solo muestra la portada; `/design` sigue desactivada en producción. *(Desde C2a, `/` y `/design` están detrás del login.)*
  - **Aceptación:**
    - `https://os.brahua.com` responde con HTTPS y la portada de brahua-os.
    - Un merge a `main` se publica solo.
  - **Tamaño:** S

## Fase 1 — Base segura

- [x] **C1: Base de datos**
  - **Qué:**
    - Drizzle ORM + drizzle-kit, con el driver elegido según la documentación (ADR-002).
    - `drizzle.config.ts` que descubre `src/modules/*/db/schema.ts` y un cliente en `src/lib/db.ts`.
    - Tabla `core_life_areas` y primera migración.
    - Postgres desechable para pruebas: Docker (`docker compose`) en local y el servicio Postgres en CI.
    - `db:migrate` en el build de Vercel: la primera migración llega a producción con este merge.
    - Scripts `db:generate`, `db:migrate` y `db:seed` (8 áreas por defecto, idempotente).
  - **Aceptación:**
    - `pnpm db:migrate && pnpm db:seed` crea las 8 áreas; correrlo dos veces no duplica nada.
    - Una prueba de integración confirma que una transacción interactiva funciona con el driver.
  - **Archivos:** `drizzle.config.ts`, `src/lib/db.ts`, `src/modules/core/db/schema.ts`, `drizzle/`, `scripts/seed.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`, `tests/integration/`
  - **Tamaño:** M

- [x] **C2: Login de un solo usuario** — dividida en dos:
  - [x] **C2a: contraseña, protección y owner** (PR #14, integrado). Better Auth 1.7 con email + contraseña, tablas `auth_*` (migración `0001_core_auth`), rate limit en base de datos, `requireOwner()`, `pnpm auth:owner`, `/login`, `(app)` protegido (incluye `/` y `/design`). Pruebas unitarias, de integración y E2E (login, redirección y axe en ambos temas).
    - Antes del merge, el usuario agrega en Vercel (Production) `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` y `OWNER_EMAIL`; sin ellas el build de producción falla a propósito. Después del deploy ejecuta `pnpm auth:owner` contra producción (ver `docs/HANDOFF.md`).
  - [x] **C2b: passkey** (PRs #16 y #17, integrados). `@better-auth/passkey` 1.7.6 (en Better Auth 1.7 el plugin es un paquete aparte) con `rpID`, `rpName` y `origin` derivados de `BETTER_AUTH_URL` (`os.brahua.com` en producción, `localhost` en desarrollo y pruebas; en producción `BETTER_AUTH_URL` debe ser exactamente `https://os.brahua.com`). Tabla `auth_passkeys` (migración aditiva `0002_core_auth_passkeys`). "Entrar con passkey" y autocompletado (`autocomplete="username webauthn"`) en `/login`; cancelar el aviso del navegador no muestra error; sin soporte, el botón queda marcado como desactivado (`aria-disabled`) con una explicación. Verificación de usuario obligatoria (biometría o PIN del dispositivo). Registrar, renombrar y eliminar exigen haber entrado hace menos de 10 minutos. El hook de sesión bloquea passkeys de otros usuarios (prueba de integración). `pnpm auth:owner` (recuperación) borra todas las passkeys del owner. Rate limit: 5/min en `/passkey/verify-authentication` y 10/min en los otros tres endpoints de passkey. Arreglo extra: `pnpm auth:owner` valida `DATABASE_URL_UNPOOLED` antes de preguntar nada.
    - [x] **Provisional:** registrar, listar y eliminar passkeys vivía en la portada, junto a "Cerrar sesión". C4 lo movió a `/settings` (`src/app/(app)/settings/_components/`).
  - **Qué:**
    - Better Auth con email + contraseña (`disableSignUp`, mínimo 12 caracteres), plugin de passkey, rate limit en base de datos, cookies seguras y `trustedOrigins`.
    - Tablas `auth_*`.
    - `requireOwner()`.
    - `pnpm auth:owner`.
    - Pantalla `/login`, siguiendo el diseño Login de Claude Design.
    - El layout `(app)` protegido, y `/design` pasa a estar detrás del login.
  - **Aceptación:**
    - Sin sesión, `(app)` redirige a `/login`.
    - El registro está deshabilitado.
    - Un email distinto del owner se rechaza.
    - El sexto intento fallido en 60 s devuelve 429.
    - La cookie dura 30 días.
    - Hay E2E de login con contraseña y con passkey (autenticador virtual).
  - **Archivos:** `src/lib/auth.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/(auth)/login/`, `src/app/(app)/layout.tsx`, `scripts/auth-owner.ts`, tests
  - **Tamaño:** L. Se divide en C2a (contraseña, protección y owner) y C2b (passkey) si crece.

### Checkpoint 1
- [x] Inicias sesión en `os.brahua.com` con tu contraseña y registras tu passkey, desde el computador y desde el celular. Verificado por el owner el 2026-09-30: Touch ID en el computador y Face ID en el celular.

## Fase 2 — App usable

- [x] **C3: Navegación (shell)** (PR #19, integrado). Registro en `src/lib/modules.ts` (`ModuleManifest`, `navItems`, `splitBottomNav`, `isActiveHref`); manifiestos de `core` en `src/modules/core/module.ts` (Hoy disponible; Áreas y Ajustes declarados como `planned`, fuera de la navegación). `BottomNav` y `Sidebar` en `src/modules/core/components/`, portados de Claude Design con enlaces reales y `aria-current="page"`. Barra lateral desde 1024 px, colapsable con `[` (estado en la cookie `bo_sidebar`, leída en el servidor: sin parpadeo) y atajos 1–8 fijos por módulo (⌥ + número también), solo desde 1024 px y desactivables con la cookie `bo_shortcuts` (el interruptor llega en C4); barra inferior fija abajo con zona segura y "Más" cuando no caben las secciones. Tooltip del design system accesible al pasar el puntero y cerrable con Esc (WCAG 1.4.13; pendiente de subir a Claude Design). La tecla de captura se ve pero queda `aria-disabled` con la explicación "Próximamente" hasta que exista la captura rápida. Portada con saludo y fecha en hora de Lima (`src/lib/time.ts`). Sección "Navegación" en `/design`. Pruebas unitarias (registro, hora, atajos, componentes) y E2E (barras por ancho, `aria-current`, `[`, 1–8, atajos ignorados en inputs, axe y capturas en ambos temas).
  - Cuando C4 y C5 construyan `/settings` y `/areas`, basta con quitar `status: "planned"` de su manifiesto.
  - **Qué:**
    - Registro de módulos (`src/lib/modules.ts`, `ModuleManifest`).
    - `BottomNav` (celular, 5 ítems como máximo, tecla de captura) y `Sidebar` (escritorio, colapsable con `[`, atajos 1–8), portados de `components/patterns/Navigation` de Claude Design.
    - Página de inicio provisional con saludo y fecha en hora de Lima (`src/lib/time.ts`).
  - **Aceptación:**
    - A 390 px se ve la barra inferior; desde 1024 px, la barra lateral.
    - Los ítems salen del registro.
    - El ítem activo usa `aria-current="page"`.
    - Axe en 0 y capturas en ambos temas.
  - **Tamaño:** M

- [x] **C4: Ajustes** (PR #20, integrado). `/settings` con `requireOwner()` y título "Ajustes · brahua-os", en cuatro secciones con `SectionLabel`: **Apariencia** (Oscuro, Claro o Sistema con `SegmentedControl` en modo radio: flechas, Inicio y Fin; next-themes lo guarda y lo aplica antes de pintar), **Teclado** (interruptor "Atajos de teclado" que escribe `bo_shortcuts` y hace `router.refresh()`), **Passkeys** (la sección de C2b, movida) y **Sesión** ("Cerrar sesión", movido). La portada queda solo con el saludo. `settingsModule` pasa a disponible: Ajustes sale en el pie de la barra lateral (atajo 8) y en la barra inferior. Arreglos de la revisión de C3: el tooltip oculto usa `visibility: hidden` y no captura el puntero durante los 300 ms previos, y `e2e/support/fonts.ts` espera también IBM Plex Mono 400. Pruebas unitarias (página, selector de tema, interruptor, registro) y E2E (`e2e/settings.spec.ts`: tema que persiste sin parpadeo en las tres opciones, Sistema con `prefers-color-scheme` emulado, atajos apagados y encendidos sin recargar, 8 lleva a Ajustes, `aria-current`, axe y capturas en ambos temas; passkeys y cerrar sesión desde `/settings` en `passkey.spec.ts` y `login.spec.ts`).
  - **Qué:** `/settings` con el tema (Oscuro, Claro o Sistema), la gestión de passkeys (registrar, listar, borrar) y cerrar sesión.
    - Interruptor "Atajos de teclado" (WCAG 2.1.4): escribe la cookie `bo_shortcuts` con `shortcutsCookie()` de `src/modules/core/nav-preferences.ts` (`off` los desactiva) y hace `router.refresh()`. Por defecto, activos.
    - Cambiar `settingsModule` a disponible (quitar `status: "planned"`).
    - Mover aquí la sección provisional de passkeys (ya registra, lista y elimina) y el botón "Cerrar sesión" de la portada (C2b), y quitarlos de `/`. No hay que construir la gestión de passkeys de nuevo.
  - **Aceptación:** el tema persiste; puedes registrar y borrar una passkey; cerrar sesión te lleva a `/login`; con los atajos desactivados, `[` y `1`–`8` no hacen nada y no se muestran sus pistas (E2E).
  - **Tamaño:** M

- [x] **C5: Áreas de vida — ver y crear** (PR `feat/core-c5-areas`). `/areas` con `requireOwner()`, título "Áreas · brahua-os" y la lista de áreas activas en su orden (`ListRow` + `AreaTag` grande; las archivadas quedan fuera hasta C6), con estado vacío. "Nueva área" (tecla naranja en la cabecera) y cada fila abren un `Sheet` (hoja inferior en el celular, panel lateral desde 1024 px) con nombre, color (8 paletas con nombre: Ámbar, Verde, Turquesa, Índigo, Violeta, Rosa, Celeste, Lima) e ícono (los 55 del set curado, con nombre en español), ambos como `radiogroup` con una sola parada de Tab y flechas (↑/↓ por filas en la grilla), y una vista previa fija arriba con `AreaTag`. Server Actions `createLifeArea` y `updateLifeArea` (`src/modules/core/actions.ts`) construidas con `ownerAction()` (`src/lib/owner-action.ts`: sesión primero —sin sesión u otro email → error de autorización sin mirar el input—, Zod, y los errores inesperados se registran y vuelven como un error genérico), con el esquema de `life-area-input.ts` que también valida antes en el cliente (nombre normalizado, sin caracteres de control ni invisibles). `CHECK` en la base para color, ícono y largo del nombre (migración aditiva `0003`), errores por campo con `aria-invalid` + `aria-describedby` y foco en el primero. Mientras guarda, la hoja no se puede cerrar. Al guardar: `revalidatePath("/areas")`, se cierra la hoja, el foco vuelve a "Nueva área" o a la fila editada y, cuando la hoja terminó de cerrarse (`onClosed` del `Sheet`), se anuncia en una región `status`. Revisión 1 aplicada (cierre tardío, anuncio, higiene del nombre, `CHECK`, vista previa en pantallas bajas, `ownerAction`, `server-only`, carga diferida de la hoja, colores forzados, nombres largos). Slug con `slugify` (`src/lib/text.ts`) y sufijo `-2`, `-3`… si ya existe (también los del seed: "Home" → `home-2`); editar nunca cambia el slug ni la posición. `sortOrder` = máximo + 1 (archivadas incluidas) dentro de una transacción con un *advisory lock*; si otro escritor sin el lock (seed, importadores) gana la carrera del slug, se reintenta. `areasModule` disponible (pie de la barra lateral, atajo 7). La E2E siembra las 8 áreas (`seed` pasó a `src/modules/core/seed.ts`). Pruebas unitarias (slugify, esquema, `ActionResult`, página, hoja, radio grid), de integración (crear, editar, validación, sin sesión, sesión falsa, sesión de otro email, colisión con el seed, `sortOrder`, concurrencia y carrera del slug) y E2E (`e2e/areas.spec.ts`: crear, editar, errores por campo, recorrido solo con teclado, axe y capturas en ambos temas, en celular y escritorio).
  - **Qué:**
    - `/areas` con la lista (`ListRow` + `AreaTag`).
    - Crear y editar en un `Sheet`: nombre, paleta (una de las 8) e ícono (set curado).
    - Server Actions con `ActionResult` y Zod.
  - **Aceptación:**
    - Crear y editar funcionan.
    - Los errores de validación se ven por campo.
    - Sin sesión, las acciones se rechazan.
    - Hay pruebas de integración de las acciones.
  - **Tamaño:** M

- [x] **C6: Áreas de vida — reordenar y archivar** (PR `feat/core-c6-areas-order`, sin merge). Cada fila tiene un asa para arrastrar (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 + `@dnd-kit/utilities` 3.2.2, fijadas; ratón, toque con presión corta y teclado: Espacio/Enter, flechas, Espacio/Enter, Esc cancela, anunciado en español) y teclas "Subir"/"Bajar" (con `aria-disabled` en los extremos; el foco se queda en la tecla). `reorderLifeAreas` recibe los ids de todas las activas y, dentro de una transacción con `LIFE_AREAS_LOCK`, rechaza una lista vieja o alterada sin escribir nada (y la respuesta trae la lista actual); reescribe `sort_order` de todas, contiguo. Archivar desde la hoja de edición ("Archivar área", con su explicación); la sección plegable "Archivadas" (con la cantidad) lista las archivadas, de solo lectura, con "Desarchivar" (al final de la lista). **Decisión: un área archivada no se edita hasta desarchivarla** (`updateLifeArea` lo rechaza con un mensaje claro). Archivar conserva `sort_order`, así que "Deshacer" la devuelve a su lugar. UI optimista con `useOptimistic` (reducer `areas-optimistic.ts`): si el servidor rechaza, vuelve atrás y un aviso explica por qué. Avisos con el `Toast` del design system y una cola propia (`src/lib/toast/`, `components/toast-viewport.tsx`): uno a la vez, región `polite` siempre presente, nunca toma el foco, 10 s con acción, 6 s sin ella y 12 s los errores, pausa con el puntero, el foco, un diálogo abierto o la pestaña oculta, Esc lo cierra (también desde la página), la región evita tapar el foco (`--toast-offset`), "Deshacer" con Tab o ⌘Z / Ctrl+Z; varios movimientos seguidos comparten un aviso y "Deshacer" vuelve al orden de antes. Movimiento reducido: sin transiciones de dnd-kit ni desplazamiento suave, el aviso solo aparece con un fundido. Pruebas unitarias (helpers de orden, reducer optimista, cola, toaster con relojes falsos, atajo ⌘Z, pantalla), de integración (reordenar válido, lista vieja, alterada, malformada, creación concurrente esperando el lock, archivar, desarchivar, deshacer, editar archivada, sin sesión) y E2E (`e2e/areas-order.spec.ts`: botones, arrastre con teclado y ratón, Esc, archivar, deshacer, desarchivar, ⌘Z, movimiento reducido y axe con el aviso y las archivadas en ambos temas, en celular y escritorio).
  - **Qué:**
    - Reordenar arrastrando (`@dnd-kit`), con botones subir y bajar como alternativa accesible, en una transacción.
    - Archivar y desarchivar.
    - UI optimista (`useOptimistic`) y `Toast` con "Deshacer" (cola de avisos).
    - Reordenar toma `LIFE_AREAS_LOCK` (`src/modules/core/life-areas.ts`), el mismo *advisory lock* que crear (C5), para que una creación simultánea no repita un `sort_order`.
    - Decidir si un área archivada se puede editar: no, hasta desarchivarla.
  - **Aceptación:**
    - El cambio se ve al instante.
    - "Deshacer" revierte.
    - Con movimiento reducido no hay animaciones de desplazamiento.
    - E2E del recorrido completo.
  - **Tamaño:** M

### Mejoras de proceso

- [ ] **E2E más rápida sin bajar el control de CI** (PR `chore/faster-e2e`). E2E nativa por spec mientras se itera (las capturas se saltan fuera de la imagen Linux de Playwright con `expectScreenshot()` y quedan anotadas); `pnpm test:e2e:changed`; workflow `update-screenshots.yml` que regenera las referencias en GitHub, las commitea como github-actions[bot] y vuelve a correr CI; de 94 a 30 capturas (una por pantalla, tema y viewport, más 4 secciones del design system en escritorio); job `smoke` de solo lectura contra https://os.brahua.com después de cada deploy; el registro de errores de las Server Actions ya no guarda mensajes de Postgres.
- [x] **Build en Vercel para variables Sensitive** (PR `chore/faster-e2e`)
  - **Contexto:** el 2026-10-01 las variables de Neon pasaron a *Sensitive* (primero con el store en "Production environment only"; al volver a "All environments" y rotar, Vercel las recreó igual como *Sensitive*). El job `deploy` corría `vercel pull` + `vercel build` en GitHub Actions, donde los valores *Sensitive* llegan como el marcador `[sensitive]`: la migración falló con "Invalid URL" y no se desplegó nada. El owner restauró producción con un deploy manual con build remoto de `main@954bdf6`.
  - **Hecho:** el job `deploy` usa `vercel deploy --prod` (build remoto en Vercel, sin `pull` ni `--prebuilt`): `scripts/vercel-build.sh` migra y siembra dentro de Vercel, donde las variables *Sensitive* sí están. Se mantienen `needs: [checks, e2e, integration]`, la condición de push a `main` y el grupo `deploy-production`. `.vercelignore` evita subir `.env*` y carpetas que el build no usa.
  - **Aceptación:** el primer deploy después del merge y su smoke pasan con las variables de la base *Sensitive*.

### Checkpoint 2
- [ ] Recorrido completo en celular y escritorio: login → navegar → crear, editar, reordenar y archivar un área → cambiar tema → cerrar sesión. Lo revisamos juntos.

## Fase 3 — Plataforma

- [ ] **C7: PWA y cabeceras de seguridad**
  - **Qué:** `app/manifest.ts` con íconos de 192, 512 y *maskable* derivados de la marca en Archivo 800, `theme_color` y modo standalone. Cabeceras `frame-ancestors 'none'` y `Referrer-Policy`.
    - [x] Cabeceras de seguridad: adelantadas en C2a (`next.config.ts`: `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`), con su E2E en `e2e/login.spec.ts`. Queda el manifest.
    - [x] PWA (PR `feat/core-c7-pwa`, sin merge): `src/app/manifest.ts`, íconos generados con `pnpm icons:build` (`scripts/build-icons.tsx`), favicon y `apple-icon`, `appleWebApp`, `theme-color` por tema, E2E `e2e/pwa.spec.ts` y el manifest en el smoke test. Ver "Cómo funciona la PWA (C7)" en `docs/HANDOFF.md`.
    - [ ] Verificación manual: instalar en el iPhone (y en Android si hay uno a mano) y entrar con passkey dentro de la app instalada.
  - **Aceptación:** una E2E valida el manifest y las cabeceras; la app se instala en tu celular en modo standalone.
  - **Tamaño:** S

- [ ] **C8: Páginas de error** — PR `feat/core-c8-error-pages`, sin merge (pendiente de revisión).
  - **Qué:** `error.tsx`, `not-found.tsx` y `global-error.tsx` en español, con el design system (LCD "sin culpa").
    - [x] 404 (`app/not-found.tsx` con el shell si hay sesión; `(app)/not-found.tsx` para `notFound()`), errores (`(app)/error.tsx` dentro del shell, `app/error.tsx` fuera de él) y `global-error.tsx` propio, oscuro por defecto.
    - [x] Rutas de prueba que fuerzan errores solo en builds E2E (`page.e2e.tsx` + `E2E_ERROR_ROUTES`), comprobadas en CI y en el smoke test (404 en producción).
  - **Aceptación:** un error forzado muestra la página sin detalles técnicos; axe en 0.
    - [x] E2E `e2e/error-pages.spec.ts` (sin mensaje ni stack en la respuesta, "Reintentar", axe en ambos temas, 8 capturas nuevas).
  - **Tamaño:** S

## Fase 4 — Producción

- [ ] **C10: Operación**
  - **Qué:**
    - `pnpm db:export` (JSON).
    - GitHub Action semanal con `pg_dump` guardado como artefacto privado del repo.
    - ADRs 001–005 en `docs/adr/`.
  - **Aceptación:** la Action corre manualmente y deja el respaldo; los ADRs están escritos.
  - **Tamaño:** S

### Checkpoint final
- [ ] Se cumplen los criterios de éxito de `SPEC-core.md`.
- [ ] Revisión contigo antes del siguiente módulo (`projects`).
