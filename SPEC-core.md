# Spec: core

> Módulo `core` del [mapa de capacidades](CAPABILITY-MAP.md) · Estado: **BORRADOR v2 — pendiente de aprobación**
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
4. Creo, edito, reordeno y archivo mis áreas de vida (nombre, emoji, color), y puedo deshacer al instante.
5. Navego entre módulos con una barra inferior en el celular y una barra lateral en el escritorio.
6. El tema sigue al sistema por defecto y puedo fijarlo en Ajustes.

## Decisiones técnicas

| Tema | Decisión | Por qué |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions), TypeScript `strict` | Un solo lenguaje de punta a punta. |
| Runtime | Node.js 24 en Vercel (Fluid Compute) | Es el runtime por defecto actual. |
| Base de datos | Postgres en **Neon** (Vercel Marketplace). La integración Neon ↔ Vercel crea una rama de BD por preview. | Postgres gestionado; los previews no tocan producción. |
| Driver | Drizzle con el driver serverless de Neon (Pool por WebSocket, que admite transacciones) sobre `DATABASE_URL` *pooled*. **Verificar** en la documentación oficial al implementar si conviene `pg` estándar con Fluid Compute. | Reordenar necesita transacciones. |
| Migraciones | `drizzle-kit generate` en local. `drizzle-kit migrate` con `DATABASE_URL_UNPOOLED` en el build de Vercel, antes de `next build`; **si la migración falla, falla el deploy**. | Migraciones versionadas y siempre aplicadas. |
| Autenticación | **Better Auth**: email + contraseña (mínimo 12 caracteres) + plugin **passkey**. `disableSignUp: true`: el owner solo se crea con `pnpm auth:owner`. | Sin superficie de registro pública; los datos quedan en mi propia base. |
| UI | Tailwind CSS v4 + shadcn/ui, íconos lucide, `next-themes`, `sonner` (toasts con Deshacer), `@dnd-kit/core` + `@dnd-kit/sortable` (reordenar) | Lo mínimo para cumplir los principios UX en `core`. |
| Movimiento | `motion` (Motion for React) | Base de animación (ver `docs/principios-ux.md`). |
| PWA | Solo `app/manifest.ts` + íconos (192, 512 y *maskable*). **Sin service worker en `core`**: se pospone al módulo `reminders`, que lo necesita para push. | Instalar no lo requiere, y un SW que cachea HTML autenticado arriesga mostrar datos viejos. |
| Validación | **Zod**, con `safeParse` en cada Server Action | Una sola fuente para tipos y validación. |
| Fechas | `timestamptz` en UTC; "hoy" se calcula en `America/Lima` con `@date-fns/tz` (`TZDate`) desde `src/lib/time.ts`. En el servidor nunca se usa `new Date()` para decidir el día. | El servidor corre en UTC. |
| Gestor de paquetes | pnpm | |

## Comandos

```bash
pnpm install                 # Install dependencies
pnpm dev                     # Dev server (http://localhost:3000)
pnpm build                   # db:migrate + next build (Vercel uses this)
pnpm lint                    # ESLint
pnpm typecheck               # tsc --noEmit
pnpm test                    # Vitest (unit + integration)
pnpm test:e2e                # Playwright against local `next start`
pnpm db:generate             # drizzle-kit generate → new SQL migration
pnpm db:migrate              # drizzle-kit migrate (DATABASE_URL_UNPOOLED)
pnpm db:seed                 # Seed default life areas (idempotent)
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
} satisfies ModuleManifest;
```

Reglas:

- Un módulo solo importa de `@/lib`, `@/components` y **de los módulos de los que depende según el mapa**.
- Los esquemas se descubren con `drizzle.config.ts` → `schema: "./src/modules/*/db/schema.ts"`.
- Nombres de tabla en `snake_case`: prefijo `<module>_` solo si el nombre no empieza ya por el módulo (`core_life_areas`, `projects`, `tasks`, `habit_logs`).
- La barra inferior tiene como máximo 5 ítems; el resto va en "Más".

## Modelo de datos (core)

```ts
// src/modules/core/db/schema.ts
export const LIFE_AREA_COLORS = [
  "slate", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink",
] as const;

export const lifeAreas = pgTable("core_life_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // stable key for seeding/imports
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("📁"),
  color: text("color", { enum: LIFE_AREA_COLORS }).notNull().default("slate"),
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
- **Emoji:** exactamente 1 grafema, validado con `Intl.Segmenter` (así los emojis compuestos no se cortan).
- **Reordenar:** reescribe `sort_order` de todas las áreas dentro de una transacción.
- **Colores:** cada valor de `LIFE_AREA_COLORS` es un token CSS definido para el tema claro y el oscuro.
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
import { isSingleGrapheme, slugify } from "@/lib/text";
import { LIFE_AREA_COLORS, lifeAreas, type LifeArea } from "./db/schema";

const createLifeAreaSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  emoji: z.string().refine(isSingleGrapheme, "Usa un solo emoji"),
  color: z.enum(LIFE_AREA_COLORS),
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
- Manifiesto: `coreModule`.

## Estrategia de pruebas

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitarias | Vitest | Schemas Zod, `isSingleGrapheme`, `slugify`, helpers de `time.ts`, registro de módulos |
| Integración | Vitest + Postgres en contenedor (servicio de GitHub Actions o Docker local) | Server Actions contra la BD real: CRUD de áreas, archivado, reordenar en transacción, seed idempotente, `requireOwner` rechaza sin sesión o con otro email |
| E2E | Playwright contra `next start` local + Postgres en contenedor, en viewport móvil y de escritorio | Login con el owner de prueba; passkey con el **autenticador virtual de Chromium**; crear, editar, reordenar y archivar un área con Deshacer; sin sesión redirige a `/login`; `/manifest.webmanifest` válido |

- Cada Server Action tiene al menos una prueba del caso feliz y una de validación o autorización.
- **CI (GitHub Actions)** en cada push y PR: `lint`, `typecheck`, `test`, `test:e2e` y `build`.
- **Previews de Vercel:** solo un smoke test manual; no se corre E2E contra ellos.

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
  - Migrar la BD de producción desde un preview.
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
   - Neon está conectado y cada preview usa su propia rama de BD.
   - El build falla si una migración falla.
8. **Extensibilidad:** agregar un módulo de prueba solo requiere crear `src/modules/<id>/` y registrarlo en `src/lib/modules.ts`, sin tocar el layout.
9. **Errores:**
   - Una acción con datos inválidos muestra los errores por campo.
   - Un error inesperado muestra `error.tsx` en español, sin detalles técnicos.

## Decisiones cerradas

1. **Login:** email + contraseña + passkey, con registro deshabilitado.
2. **Dominio:** **`os.brahua.com`**. `brahua.com` queda para el portafolio. En Hostinger solo se agrega un `CNAME os → cname.vercel-dns.com`.
3. **Repositorio:** `Brahua/brahua-os`, privado, en la cuenta personal.
4. **Áreas iniciales:** las 8 del seed.
5. **Idioma:** todo el código en inglés, commits incluidos; la interfaz y la documentación en español.

## Preguntas abiertas

1. **Dirección visual:** A "Monolito" o B "Señal", o una mezcla. Define los tokens de color y la tipografía de `core`, y se actualizará `docs/principios-ux.md` §2.
2. **Driver:** Neon serverless o `pg` con Fluid Compute. Se confirma con la documentación al empezar la implementación; no bloquea la aprobación.
