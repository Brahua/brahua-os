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

- [ ] **C2: Login de un solo usuario** — dividida en dos:
  - [x] **C2a: contraseña, protección y owner** (PR `feat/core-c2a-login`, pendiente de merge). Better Auth 1.7 con email + contraseña, tablas `auth_*` (migración `0001_core_auth`), rate limit en base de datos, `requireOwner()`, `pnpm auth:owner`, `/login`, `(app)` protegido (incluye `/` y `/design`). Pruebas unitarias, de integración y E2E (login, redirección y axe en ambos temas).
    - Antes del merge, el usuario agrega en Vercel (Production) `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` y `OWNER_EMAIL`; sin ellas el build de producción falla a propósito. Después del deploy ejecuta `pnpm auth:owner` contra producción (ver `docs/HANDOFF.md`).
  - [ ] **C2b: passkey.** Plugin de passkey (`rpID: "os.brahua.com"`), tabla `auth_passkeys`, E2E con el autenticador virtual de Chromium. Pendiente.
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
- [ ] Inicias sesión en `os.brahua.com` con tu contraseña y registras tu passkey, desde el computador y desde el celular.

## Fase 2 — App usable

- [ ] **C3: Navegación (shell)**
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

- [ ] **C4: Ajustes**
  - **Qué:** `/settings` con el tema (Oscuro, Claro o Sistema), la gestión de passkeys (registrar, listar, borrar) y cerrar sesión.
  - **Aceptación:** el tema persiste; puedes registrar y borrar una passkey; cerrar sesión te lleva a `/login`.
  - **Tamaño:** M

- [ ] **C5: Áreas de vida — ver y crear**
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

- [ ] **C6: Áreas de vida — reordenar y archivar**
  - **Qué:**
    - Reordenar arrastrando (`@dnd-kit`), con botones subir y bajar como alternativa accesible, en una transacción.
    - Archivar y desarchivar.
    - UI optimista (`useOptimistic`) y `Toast` con "Deshacer" (cola de avisos).
  - **Aceptación:**
    - El cambio se ve al instante.
    - "Deshacer" revierte.
    - Con movimiento reducido no hay animaciones de desplazamiento.
    - E2E del recorrido completo.
  - **Tamaño:** M

### Checkpoint 2
- [ ] Recorrido completo en celular y escritorio: login → navegar → crear, editar, reordenar y archivar un área → cambiar tema → cerrar sesión. Lo revisamos juntos.

## Fase 3 — Plataforma

- [ ] **C7: PWA y cabeceras de seguridad**
  - **Qué:** `app/manifest.ts` con íconos de 192, 512 y *maskable* derivados de la marca en Archivo 800, `theme_color` y modo standalone. Cabeceras `frame-ancestors 'none'` y `Referrer-Policy`.
    - [x] Cabeceras de seguridad: adelantadas en C2a (`next.config.ts`: `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`), con su E2E en `e2e/login.spec.ts`. Queda el manifest.
  - **Aceptación:** una E2E valida el manifest y las cabeceras; la app se instala en tu celular en modo standalone.
  - **Tamaño:** S

- [ ] **C8: Páginas de error**
  - **Qué:** `error.tsx`, `not-found.tsx` y `global-error.tsx` en español, con el design system (LCD "sin culpa").
  - **Aceptación:** un error forzado muestra la página sin detalles técnicos; axe en 0.
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
