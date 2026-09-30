# Spec: core

> Módulo `core` del [mapa de capacidades](CAPABILITY-MAP.md) · Estado: **APROBADO v2** (2026-09-29)
> v2.3 (2026-09-30): C4. El tema es oscuro por defecto (como dice `SPEC-design-system.md`, que prevalece en lo visual); en Ajustes se elige Oscuro, Claro o Sistema.
> v2.2 (2026-09-30): C3. El manifiesto de módulo gana `navGroup`, `shortcut` y `status`; los atajos de una tecla se pueden desactivar (preferencia en Ajustes); la hora de Lima usa `Intl`.
> v2.1 (2026-09-29): áreas con ícono de Lucide y colores del design system.
> v2 (2026-09-29): el código pasa a estar en inglés y se incorpora la revisión técnica (auth, driver, migraciones, E2E, PWA, errores, backups y zona horaria).

## Objetivo

Construir la base sobre la que se montan todos los demás módulos de brahua-os:

- Una app web instalable (PWA) protegida con login, que solo yo puedo usar.
- Navegación que funcione en el celular y en el escritorio.
- Las **áreas de vida** (`life areas`), que clasifican transversalmente todo lo demás.
- Una convención clara para que agregar un módulo nuevo sea predecible.

`core` no trae funcionalidades "de negocio". Su éxito se mide en que el siguiente módulo (`projects`) se pueda construir sin tocar la infraestructura.

### Historias de usuario

1. Como único usuario, inicio sesión y la sesión se mantiene semanas en mi celular sin volver a pedirme credenciales.
2. Nadie más puede registrarse ni ver ningún dato, aunque conozca la URL.
3. Instalo la app en la pantalla de inicio del celular y se abre como una app, sin la barra del navegador.
4. Creo, edito, reordeno y archivo mis áreas de vida (nombre, ícono, color), y puedo deshacer al instante.
5. Navego entre módulos con una barra inferior en el celular y una barra lateral en el escritorio.
6. El tema es oscuro por defecto y en Ajustes puedo fijarlo en Claro o hacer que siga al sistema.

## Decisiones técnicas

| Tema | Decisión | Por qué |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions), TypeScript `strict` | Un solo lenguaje de punta a punta. |
| Runtime | Node.js 24 en Vercel (Fluid Compute) | Es el runtime por defecto actual. |
| Base de datos | Postgres en **Neon** (Vercel Marketplace). **MVP: un solo ambiente, producción** (sin previews ni ramas por preview). Las pruebas usan un Postgres desechable local o del CI, nunca producción. | Agilidad para un solo usuario, sin riesgo para los datos reales. |
| Driver | Drizzle con `pg` (node-postgres) y `attachDatabasePool` de `@vercel/functions` en Fluid Compute, sobre `DATABASE_URL` *pooled* ([ADR-002](docs/adr/002-database-driver.md)). | Reordenar necesita transacciones; es lo que recomienda Neon para Vercel. |
| Migraciones | `drizzle-kit generate` en local. `drizzle-kit migrate` con `DATABASE_URL_UNPOOLED` en el build de Vercel, antes de `next build`; **si la migración falla, falla el deploy**. Durante el MVP solo son aditivas; una que borre o renombre requiere aviso y respaldo previo. | Migraciones versionadas y siempre aplicadas sin perder datos. |
| Autenticación | **Better Auth**: email + contraseña (mínimo 12 caracteres) + plugin **passkey**. `disableSignUp: true`: el owner solo se crea con `pnpm auth:owner`. | Sin superficie de registro pública; los datos quedan en mi propia base. |
| UI | Tailwind CSS v4 + shadcn/ui, íconos lucide, `next-themes`, `sonner` (toasts con Deshacer), `@dnd-kit/core` + `@dnd-kit/sortable` (reordenar) | Lo mínimo para cumplir los principios UX en `core`. |
| Movimiento | `motion` (Motion for React) | Base de animación (ver `docs/principios-ux.md`). |
| PWA | Solo `app/manifest.ts` + íconos (192, 512 y *maskable*). **Sin service worker en `core`**: se pospone al módulo `reminders`, que lo necesita para push. | Instalar no lo requiere, y un SW que cachea HTML autenticado arriesga mostrar datos viejos. |
| Validación | **Zod**, con `safeParse` en cada Server Action | Una sola fuente para tipos y validación. |
| Fechas | `timestamptz` en UTC; "hoy" se calcula en `America/Lima` desde `src/lib/time.ts`, con `Intl.DateTimeFormat` y `timeZone` explícito (C3). `@date-fns/tz` (`TZDate`) se agrega cuando haga falta aritmética de fechas. En el servidor nunca se usa la zona horaria del proceso para decidir el día. | El servidor corre en UTC. |
| Gestor de paquetes | pnpm | |

## Comandos

```bash
pnpm install                 # Install dependencies
pnpm dev                     # Dev server (http://localhost:3000)
pnpm build                   # next build (Vercel runs scripts/vercel-build.sh: db:migrate + db:seed in production, then build)
pnpm lint                    # ESLint
pnpm typecheck               # tsc --noEmit
pnpm test                    # Vitest (unit, no database)
pnpm test:integration        # Vitest against TEST_DATABASE_URL (docker compose up -d)
pnpm test:e2e                # Playwright against local `next start`
pnpm db:generate             # drizzle-kit generate → new SQL migration
pnpm db:migrate              # drizzle-kit migrate (DATABASE_URL_UNPOOLED)
pnpm db:seed                 # Seed default life areas (idempotent, DATABASE_URL_UNPOOLED only)
pnpm db:export               # Dump every table to JSON (manual backup)
pnpm auth:owner              # Create/reset the owner (OWNER_EMAIL + interactive password)
vercel env pull .env.local   # Pull env vars from Vercel
```

## Estructura del proyecto

```
src/
  app/
    (auth)/login/            → Login page
    (app)/                   → Protected routes (layout checks the session)
      layout.tsx
      page.tsx               → Home (placeholder until the `today` module)
      areas/                 → Life areas management
      settings/              → Passkeys, theme, session
      error.tsx  not-found.tsx
    api/auth/[...all]/       → Better Auth handler
    global-error.tsx
    manifest.ts
  modules/
    <module-id>/             → One folder per module in the map
      db/schema.ts           → Module tables (Drizzle)
      actions.ts             → Server Actions (mutations)
      queries.ts             → Reads (server-only)
      components/            → Module UI
      module.ts              → Module manifest (navigation)
    core/                    → Core follows the same convention (life areas)
  lib/
    db.ts                    → Drizzle client
    auth.ts                  → Better Auth config + requireOwner()
    action-result.ts         → ActionResult<T> type + helpers
    modules.ts               → Registry of active modules
    time.ts                  → Timezone helpers (America/Lima)
  components/ui/             → shadcn components
drizzle/                     → Generated SQL migrations (versioned)
scripts/                     → seed, auth-owner, export, Notion importers
tests/                       → Unit + integration (Vitest)
e2e/                         → Playwright
docs/adr/                    → Architecture Decision Records
```

- **Rutas en inglés** (`/areas`, `/settings`, `/login`): forman parte del código. Los títulos de página y los textos visibles van en español.

### Convención de módulos

El manifiesto de un módulo solo describe su navegación. Los contratos entre módulos (por ejemplo, el "resumen de hoy" que consume `today`) se definen en la spec del módulo proveedor, cuando haga falta.

```ts
// src/modules/projects/module.ts
import { FolderKanban } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

export const projectsModule = {
  id: "projects",
  label: "Proyectos", // user-facing copy stays in Spanish
  icon: FolderKanban,
  href: "/projects",
  navOrder: 20,
  shortcut: 2, // number key 1–8, fixed per module
} satisfies ModuleManifest;
```

Campos del manifiesto (`src/lib/modules.ts`):

- `id`, `label` (en español), `icon` (Lucide), `href` y `navOrder`: obligatorios. `id`, `href` y `shortcut` son únicos; el registro rechaza duplicados.
- `navGroup`: `main` (por defecto, arriba en la barra lateral) o `footer` (fijos abajo: Áreas y Ajustes).
- `shortcut`: tecla numérica **fija** del módulo (1–8). No se recalcula cuando otros módulos aparecen: Hoy = 1, Áreas = 7, Ajustes = 8, como en el diseño. Sin `shortcut`, el módulo no tiene atajo.
- `status`: `available` (por defecto) o `planned`. Un módulo `planned` se declara antes de construirlo y no aparece en la navegación.
- Los manifiestos se importan desde la navegación, que es un Client Component: **solo datos y el ícono**, nunca código de servidor (base de datos, auth, `server-only`).
- Los manifiestos de `core` son `homeModule` (Hoy, `/`, provisional hasta el módulo `today`), `areasModule` y `settingsModule`, en `src/modules/core/module.ts`.

Reglas:

- Un módulo solo importa de `@/lib`, `@/components` y **de los módulos de los que depende según el mapa**.
- Los esquemas se descubren con `drizzle.config.ts` → `schema: "./src/modules/*/db/schema.ts"`.
- Nombres de tabla en `snake_case`: prefijo `<module>_` solo si el nombre no empieza ya por el módulo (`core_life_areas`, `projects`, `tasks`, `habit_logs`).
- La barra inferior tiene como máximo 5 ítems; el resto va en "Más".
- **Atajos de una tecla** (`[`, `1`–`8`, y ⌥ + número como alternativa): solo desde 1024 px, nunca al escribir ni dentro de listas, menús, grillas o diálogos. Se pueden **desactivar** en Ajustes (WCAG 2.1.4): la preferencia vive en la cookie `bo_shortcuts` (`off` los apaga; por defecto están activos) y el layout la lee en el servidor. Apagados, no se registra ningún listener ni se muestran pistas (`Kbd`, `aria-keyshortcuts`). El estado de la barra lateral (contraída o no) también es una cookie por dispositivo (`bo_sidebar`).

## Modelo de datos (core)

```ts
// src/modules/core/db/schema.ts
import { AREA_COLORS, AREA_ICON_NAMES } from "@/design-system";

export const lifeAreas = pgTable("core_life_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // stable key for seeding/imports
  name: text("name").notNull(),
  // No defaults: actions and the seed always provide a valid icon and color.
  icon: text("icon", { enum: AREA_ICON_NAMES }).notNull(), // Lucide icon from the curated set
  color: text("color", { enum: AREA_COLORS }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type LifeArea = typeof lifeAreas.$inferSelect;
export type NewLifeArea = typeof lifeAreas.$inferInsert;
```

- **Sin valores por defecto en `icon` y `color`** (C1): el `"circle"` de la versión anterior no está en el set curado; las acciones y el seed siempre los envían.
- **Seed inicial** (idempotente, con `onConflictDoNothing({ target: lifeAreas.slug })`):
  - `home` → Hogar
  - `health` → Salud y Bienestar
  - `finance` → Finanzas e Inversiones
  - `learning` → Aprendizaje y Desarrollo profesional
  - `work` → Trabajo
  - `relationships` → Relaciones y Familia
  - `travel` → Planes y Viajes
  - `hobbies` → Hobbies
- **Sin borrado físico** en `core`: solo se archiva. Un área archivada deja de ofrecerse para elementos nuevos, pero se sigue mostrando en los que ya la usan. Las FK futuras hacia `core_life_areas` usan `onDelete: "restrict"`.
- **Ícono:** nombre de un ícono de **Lucide** dentro del set curado `AREA_ICON_NAMES` del design system. No se usan emojis en ningún lugar de la app.
- **Reordenar:** reescribe `sort_order` de todas las áreas dentro de una transacción.
- **Colores:** `AREA_COLORS` viene del design system: 8 paletas con nombre de área (`home`, `health`, `finance`, `learning`, `work`, `relationships`, `travel`, `hobbies`). Cada una tiene su tono base y su tono inverso para ambos temas. Las áreas que crees eligen una de estas 8 paletas y pueden compartirla; se distinguen por el ícono.
- **Tablas de Better Auth**, renombradas con `modelName` para evitar `user`, que es palabra reservada en Postgres: `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_passkeys` y `auth_rate_limits`.

## Autenticación y seguridad

- `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 }`.
- **Owner:**
  - Se crea con `pnpm auth:owner`, ejecutado en local contra `DATABASE_URL_UNPOOLED`.
  - No hay reseteo por email: la recuperación es volver a ejecutar el script.
- **`requireOwner()`:**
  - Valida la sesión y que `session.user.email === OWNER_EMAIL`.
  - En páginas hace `redirect("/login")`; en acciones devuelve un error de autorización.
  - La sesión se verifica en el layout de `(app)` y en cada acción o query, **nunca solo en `proxy.ts`**.
- **Sesión:** `expiresIn` de 30 días, `updateAge` de 1 día.
- **Cookies:** `secure` y `sameSite: "lax"`. Se usa el plugin `nextCookies()`.
- **Rate limit:** `{ enabled: true, storage: "database", customRules: { "/sign-in/email": { window: 60, max: 5 } } }`. El almacenamiento en memoria no sirve en serverless.
- **`trustedOrigins`:** `https://os.brahua.com` más el origen del preview actual (`VERCEL_BRANCH_URL`).
- **Passkey:**
  - `rpID: "os.brahua.com"` con `origin` explícito.
  - Funciona solo en producción: en los previews el dominio no coincide.
- **Secretos:**
  - `BETTER_AUTH_SECRET` de al menos 32 caracteres, distinto por entorno.
  - Las variables se limitan a su entorno de Vercel.
- **Cabeceras:** `Content-Security-Policy: frame-ancestors 'none'` y `Referrer-Policy: strict-origin-when-cross-origin`.

## Estilo de código

- **Todo el código va en inglés:** identificadores, comentarios, archivos, carpetas, rutas, tablas, columnas, ids de módulo, scripts y **mensajes de commit**. Sin excepciones.
- **Solo el texto que ve el usuario va en español:** JSX, mensajes de validación, toasts y `label` de los manifiestos. No se usa librería de i18n; los textos pueden ir inline o en `src/modules/<id>/copy.ts`.
- Todo Server Action y toda query empiezan con `requireOwner()`.
- Las acciones devuelven `ActionResult<T>`, nunca lanzan errores de validación al cliente.
- Server Components por defecto; `"use client"` solo cuando hay interacción.
- Mutaciones con UI optimista (`useOptimistic`) y toast "Deshacer" cuando son reversibles.
- Prettier + ESLint (config de Next.js), sin `any` ni `@ts-ignore`.
- Commits en Conventional Commits, en inglés: `feat(core): add life areas`.

```ts
// src/modules/core/actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { AREA_COLORS, AREA_ICON_NAMES } from "@/design-system";
import { slugify } from "@/lib/text";
import { lifeAreas, type LifeArea } from "./db/schema";

const createLifeAreaSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  icon: z.enum(AREA_ICON_NAMES),
  color: z.enum(AREA_COLORS),
});

export async function createLifeArea(input: unknown): Promise<ActionResult<LifeArea>> {
  await requireOwner();
  const parsed = createLifeAreaSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error);

  const [area] = await db
    .insert(lifeAreas)
    .values({ ...parsed.data, slug: slugify(parsed.data.name) })
    .returning();
  revalidatePath("/areas");
  return ok(area);
}
```

```ts
// src/lib/action-result.ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
```

**Nombres de `core`:**
- Acciones: `createLifeArea`, `updateLifeArea`, `reorderLifeAreas`, `archiveLifeArea`, `unarchiveLifeArea`.
- Queries: `listLifeAreas({ includeArchived })`.
- Manifiestos: `homeModule`, `areasModule`, `settingsModule` (ver "Convención de módulos").

## Estrategia de pruebas

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitarias | Vitest | Schemas Zod, `slugify`, helpers de `time.ts`, registro de módulos |
| Integración | Vitest + Postgres en contenedor (servicio de GitHub Actions o Docker local) | Server Actions contra la BD real: CRUD de áreas, archivado, reordenar en transacción, seed idempotente, `requireOwner` rechaza sin sesión o con otro email |
| E2E | Playwright contra `next start` local + Postgres en contenedor, en viewport móvil y de escritorio | Login con el owner de prueba; passkey con el **autenticador virtual de Chromium**; crear, editar, reordenar y archivar un área con Deshacer; sin sesión redirige a `/login`; `/manifest.webmanifest` válido |

- Cada Server Action tiene al menos una prueba del caso feliz y una de validación o autorización.
- **CI (GitHub Actions)** en cada push y PR: `lint`, `typecheck`, `test`, `test:e2e` y `build`.
- **Trunk-based + CI/CD (2026-09-30):**
  - Ramas cortas por cambio, con PR a `main`.
  - Cada push a `main` vuelve a correr el CI, y el job `deploy` de GitHub Actions publica en producción **solo si pasan todos los checks** (`vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod`).
  - El auto-deploy de Vercel está desactivado (`vercel.json`).
  - No hay previews durante el MVP.

## Operación

- **Backups:**
  - Un workflow semanal de GitHub Actions hace `pg_dump` hacia un almacenamiento privado.
  - `pnpm db:export` exporta a JSON en cualquier momento.
  - Se documenta la ventana de restauración que da el plan de Neon (dato a confirmar al contratarlo).
- **Observabilidad:** logs estructurados en Vercel Logs. Sin Sentry en el MVP.
- **ADRs** en `docs/adr/`:
  - 001: autenticación de un solo usuario.
  - 002: driver y migraciones.
  - 003: código en inglés y UI en español.
  - 004: PWA sin service worker hasta `reminders`.
  - 005: zona horaria.

## Límites

- **Siempre:**
  - Validar con Zod y llamar a `requireOwner()` en cada acción y query.
  - Correr lint, typecheck y tests antes de cada commit.
  - Versionar las migraciones.
  - Escribir el código en inglés y la interfaz en español.
  - Actualizar la spec antes de cambiar el diseño.
- **Preguntar primero:**
  - Agregar dependencias que no están en esta spec.
  - Cambios de esquema que alteren o borren datos existentes.
  - Cambiar la configuración de CI o de Vercel.
  - Abrir el registro a otros usuarios.
- **Nunca:**
  - Commitear secretos (`.env*` en `.gitignore`).
  - Exponer datos sin sesión.
  - Borrar migraciones ya aplicadas.
  - Correr pruebas contra la base de datos de producción.
  - Desactivar tests o reglas de lint para "pasar".
  - Escribir en Notion (solo se lee para importar).

## Criterios de éxito

1. **Login:**
   - Sin sesión, cualquier ruta de `(app)` redirige a `/login`.
   - El endpoint de registro está deshabilitado.
   - Una sesión válida con un email distinto de `OWNER_EMAIL` es rechazada.
   - El sexto intento fallido en 60 s devuelve 429.
   - La cookie de sesión tiene `Max-Age` de 30 días, y un test lo comprueba.
2. **Passkey:**
   - Puedo registrar una passkey desde Ajustes e iniciar sesión solo con ella (E2E con autenticador virtual).
   - Verificación manual: funciona dentro de la PWA instalada en iOS y en Android.
3. **PWA:**
   - `/manifest.webmanifest` responde con `name`, `display: "standalone"`, `theme_color` e íconos de 192, 512 y *maskable* (test E2E).
   - Checklist manual: se instala y abre en modo standalone en iOS y en Android.
4. **Áreas:**
   - Crear, editar, reordenar (arrastrando, y con botones subir y bajar como alternativa accesible) y archivar o desarchivar.
   - Archivar y reordenar se ven al instante y ofrecen "Deshacer".
   - El seed crea 8 áreas; correrlo dos veces no duplica nada.
5. **Navegación:**
   - En un viewport de 390 px se ve la barra inferior (5 ítems como máximo); desde 1024 px, la barra lateral.
   - Los ítems salen del registro de módulos.
6. **Calidad:**
   - Todos los checks de CI pasan.
   - Lighthouse móvil: Accesibilidad ≥ 95, LCP < 2,5 s, CLS < 0,1.
   - Con `prefers-reduced-motion: reduce` no hay animaciones de escala ni de desplazamiento.
7. **Despliegue:**
   - `https://os.brahua.com` responde con HTTPS.
   - Neon está conectado y cada merge a `main` con el CI verde se despliega solo a producción.
   - El build falla si una migración falla.
8. **Extensibilidad:** agregar un módulo de prueba solo requiere crear `src/modules/<id>/` y registrarlo en `src/lib/modules.ts`, sin tocar el layout.
9. **Errores:**
   - Una acción con datos inválidos muestra los errores por campo.
   - Un error inesperado muestra `error.tsx` en español, sin detalles técnicos.

## Decisiones cerradas

1. **Login:** email + contraseña + passkey, con registro deshabilitado.
2. **Dominio:** **`os.brahua.com`**. `brahua.com` queda para el portafolio. En Hostinger solo se agrega un registro `A os → 76.76.21.21` (lo que indica Vercel); los nameservers no se tocan.
3. **Repositorio:** `Brahua/brahua-os`, privado, en la cuenta personal.
4. **Áreas iniciales:** las 8 del seed.
5. **Idioma:** todo el código en inglés, commits incluidos; la interfaz y la documentación en español.
6. **Áreas (2026-09-29):** ícono de Lucide en lugar de emoji; los 8 colores de área del design system. `core` depende de `design-system`.
7. **Colores de áreas propias (2026-09-29):** una área nueva elige una de las 8 paletas existentes; no se agregan colores.
8. **Ambiente (2026-09-30):** durante el MVP se trabaja directo sobre producción. El despliegue va primero y cada merge a `main` con el CI verde se publica. Sin previews.

## Preguntas abiertas

1. **Dirección visual:** se itera en Claude Design (v3). Define los tokens de color y la tipografía de `core`; no bloquea el plan.
2. ~~**Driver:**~~ resuelto en C1: `pg` con Fluid Compute ([ADR-002](docs/adr/002-database-driver.md)).
