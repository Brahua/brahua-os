# Spec: nucleo

> Módulo `nucleo` del [mapa de capacidades](CAPABILITY-MAP.md) · Estado: **BORRADOR — pendiente de aprobación**

## Objetivo

Construir la base sobre la que se montan todos los demás módulos de brahua-os:

- Una app web instalable (PWA) protegida con login, que solo yo puedo usar.
- Navegación que funcione en el celular y en el escritorio.
- Las **áreas de vida**, que clasifican transversalmente todo lo demás (proyectos, tareas, hábitos, metas…).
- Una convención clara para que agregar un módulo nuevo sea predecible.

`nucleo` no trae funcionalidades "de negocio". Su éxito se mide en que el siguiente módulo (`proyectos`) se pueda construir sin tocar la infraestructura.

### Historias de usuario

1. Como único usuario, inicio sesión y la sesión se mantiene semanas en mi celular sin volver a pedirme credenciales.
2. Nadie más puede registrarse ni ver ningún dato, aunque conozca la URL.
3. Instalo la app en la pantalla de inicio del celular y se abre como una app, sin la barra del navegador.
4. Creo, edito, reordeno y archivo mis áreas de vida (nombre, emoji, color).
5. Navego entre módulos con una barra inferior en el celular y una barra lateral en el escritorio.
6. La app tiene modo claro y oscuro, según el sistema.

## Decisiones técnicas

| Tema | Decisión | Por qué |
|---|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions), TypeScript estricto | Lo que acordamos; un solo lenguaje de punta a punta. |
| Runtime | Node.js 24 en Vercel (Fluid Compute) | Es el runtime por defecto actual. |
| Base de datos | Postgres en **Neon** (Vercel Marketplace) | Postgres gestionado, con ramas para preview. |
| ORM y migraciones | **Drizzle ORM** + `drizzle-kit` | Esquema en TypeScript, SQL predecible, migraciones versionadas. |
| Autenticación | **Better Auth** con email + contraseña y **passkey**, con registro cerrado (solo el email de `OWNER_EMAIL`) | Las sesiones y usuarios viven en mi propia base; no dependo de otro SaaS. |
| UI | Tailwind CSS v4 + shadcn/ui, íconos lucide | Componentes accesibles que puedo modificar libremente. |
| PWA | `app/manifest.ts` nativo de Next.js + service worker con **Serwist** | Instalable; hay caché del shell, pero **no** hay modo offline de datos en este módulo. |
| Validación | **Zod** en toda entrada de Server Actions | Una sola fuente para tipos y validación. |
| Gestor de paquetes | pnpm | |
| Idioma | Interfaz en español; zona horaria `America/Lima`; fechas con `date-fns` + locale `es` | |

## Comandos

```bash
pnpm install                 # Dependencias
pnpm dev                     # Servidor de desarrollo (http://localhost:3000)
pnpm build                   # Build de producción
pnpm lint                    # ESLint
pnpm typecheck               # tsc --noEmit
pnpm test                    # Vitest (unitarias + integración)
pnpm test:e2e                # Playwright (e2e)
pnpm db:generate             # drizzle-kit generate → nueva migración SQL
pnpm db:migrate              # Aplica las migraciones pendientes
pnpm db:seed                 # Crea áreas de vida iniciales (idempotente)
pnpm auth:owner              # Crea o actualiza el usuario dueño (OWNER_EMAIL + contraseña interactiva)
vercel env pull .env.local   # Variables de entorno desde Vercel
```

## Estructura del proyecto

```
src/
  app/
    (auth)/login/            → Pantalla de login
    (app)/                   → Rutas protegidas (layout con navegación)
      layout.tsx
      page.tsx               → Inicio (placeholder hasta el módulo `hoy`)
      areas/                 → Gestión de áreas de vida
      ajustes/               → Ajustes (passkeys, tema, sesión)
    api/auth/[...all]/       → Handler de Better Auth
    manifest.ts
  modules/
    <id-modulo>/             → Un directorio por módulo del mapa
      db/schema.ts           → Tablas del módulo (Drizzle)
      actions.ts             → Server Actions (mutaciones)
      queries.ts             → Lecturas (server-only)
      components/            → UI del módulo
      module.ts              → Manifiesto del módulo (nav, rutas, contratos)
    nucleo/                  → El propio núcleo sigue la convención (áreas de vida)
  lib/
    db.ts                    → Cliente Drizzle
    auth.ts                  → Configuración Better Auth + helper requireOwner()
    modules.ts               → Registro de módulos activos
  components/ui/             → Componentes shadcn
drizzle/                     → Migraciones SQL generadas (versionadas)
scripts/                     → seed, auth:owner, importadores de Notion
tests/                       → Unitarias e integración (Vitest)
e2e/                         → Playwright
```

### Convención de módulos

Cada módulo exporta un manifiesto que el shell usa para construir la navegación. `hoy` y otros consumidores leen los contratos de ese manifiesto sin importar el código interno del módulo.

```ts
// src/modules/proyectos/module.ts
import { FolderKanban } from "lucide-react";
import type { ModuleManifest } from "@/lib/modules";

export const proyectosModule = {
  id: "proyectos",
  label: "Proyectos",
  icon: FolderKanban,
  href: "/proyectos",
  navOrder: 20,
} satisfies ModuleManifest;
```

Reglas:

- Un módulo solo importa de `@/lib`, `@/components` y **de los módulos de los que depende según el mapa**.
- Las tablas llevan el prefijo del módulo (`nucleo_areas`, `proyectos_proyectos`…) para que la procedencia sea obvia.

## Modelo de datos (nucleo)

```ts
// src/modules/nucleo/db/schema.ts
export const areas = pgTable("nucleo_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("📁"),
  color: text("color").notNull().default("gray"), // token de la paleta, no hex libre
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- **Seed inicial**, basado en tus Topics de Notion: Hogar, Salud y Bienestar, Finanzas e Inversiones, Aprendizaje y Desarrollo profesional, Trabajo, Relaciones y Familia, Planes y Viajes, Hobbies.
- Un área archivada deja de ofrecerse al crear elementos nuevos, pero se sigue mostrando en los elementos que ya la usan. **Nunca se borra** si tiene elementos asociados.
- Las tablas de Better Auth (`user`, `session`, `account`, `passkey`…) las genera su CLI dentro del esquema de Drizzle.

## Estilo de código

```ts
// src/modules/nucleo/actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { areas } from "./db/schema";

const crearAreaSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  emoji: z.string().min(1).max(8),
  color: z.enum(AREA_COLORS),
});

export async function crearArea(input: z.input<typeof crearAreaSchema>) {
  await requireOwner();
  const data = crearAreaSchema.parse(input);
  await db.insert(areas).values(data);
  revalidatePath("/areas");
}
```

- Los identificadores de código van en inglés o en español del dominio, según convenga (`crearArea`, `areas`), pero de forma **consistente dentro de cada módulo**. Los textos visibles van siempre en español.
- Todo Server Action y toda query empiezan con `requireOwner()`.
- Server Components por defecto; `"use client"` solo cuando hay interacción.
- Prettier + ESLint (config de Next.js), sin `any` ni `@ts-ignore`.
- Commits en español con formato Conventional Commits: `feat(nucleo): crear áreas de vida`.

## Estrategia de pruebas

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitarias | Vitest | Schemas Zod, utilidades (fechas, colores), registro de módulos |
| Integración | Vitest + Postgres de prueba (rama de Neon o Postgres en Docker) | Server Actions contra la BD real: CRUD de áreas, archivado, `requireOwner` rechaza sin sesión |
| E2E | Playwright (viewport móvil y escritorio) | Login → navegar → crear, editar, reordenar y archivar un área; acceso sin sesión redirige a `/login`; manifest válido |

- Cada Server Action tiene al menos una prueba del caso feliz y una de validación o autorización.
- CI (GitHub Actions): `lint`, `typecheck`, `test` y `build` en cada push. E2E contra el preview de Vercel.

## Límites

- **Siempre:**
  - Validar las entradas con Zod y llamar a `requireOwner()` en cada acción.
  - Correr lint, typecheck y tests antes de cada commit.
  - Versionar las migraciones.
  - Escribir la interfaz en español.
  - Actualizar la spec antes de cambiar el diseño.
- **Preguntar primero:**
  - Agregar dependencias que no están en esta spec.
  - Cambios de esquema que alteren o borren datos existentes.
  - Cambiar la configuración de CI o de Vercel.
  - Abrir el registro a otros usuarios.
- **Nunca:**
  - Commitear secretos (`.env*` va en `.gitignore`).
  - Exponer datos sin sesión.
  - Borrar migraciones ya aplicadas.
  - Desactivar tests o reglas de lint para "pasar".
  - Escribir en Notion (solo se lee para importar).

## Criterios de éxito

1. **Login:**
   - Sin sesión, cualquier ruta de `(app)` redirige a `/login`.
   - Un intento de registro con un email distinto de `OWNER_EMAIL` falla.
   - La sesión dura 30 días y se renueva con el uso.
2. **Passkey:** puedo registrar una passkey desde Ajustes e iniciar sesión solo con ella.
3. **PWA:**
   - Lighthouse marca la app como instalable.
   - En iOS y Android se abre en modo `standalone`, con nombre "brahua-os", ícono y color de tema.
4. **Áreas:**
   - Puedo crear, editar, reordenar (arrastrando o con botones subir y bajar) y archivar o desarchivar áreas.
   - Tras el seed existen las 8 áreas iniciales, y correr el seed dos veces no las duplica.
5. **Navegación:**
   - En un viewport de 390 px se ve la barra inferior; desde 1024 px, la barra lateral.
   - Los ítems salen del registro de módulos.
6. **Calidad:**
   - `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm test:e2e` pasan.
   - Lighthouse móvil da Accesibilidad ≥ 95 y LCP < 2,5 s en el inicio.
7. **Despliegue:**
   - La app está desplegada en Vercel con Neon conectado y responde en `https://os.brahua.com` con HTTPS.
   - Los previews por PR funcionan.
   - Las migraciones se aplican en el deploy.
8. **Extensibilidad:** agregar un módulo de prueba solo requiere crear `src/modules/<id>/` y registrarlo en `lib/modules.ts`, sin tocar el layout.

## Decisiones cerradas

1. **Login:** email + contraseña + passkey (aprobado).
2. **Dominio:** subdominio **`os.brahua.com`**. El dominio raíz `brahua.com` queda libre para el portafolio. En Hostinger solo se agrega un registro `CNAME os → cname.vercel-dns.com`; los nameservers no se tocan.
3. **Repositorio:** repo privado `Brahua/brahua-os` en GitHub (cuenta personal).
4. **Áreas iniciales:** las 8 del seed (aprobadas).

## Preguntas abiertas

Ninguna por ahora. Las decisiones de diseño visual e interacción se recogen en [`docs/principios-ux.md`](docs/principios-ux.md).
