# ADR-002: Driver de base de datos y migraciones

- **Estado:** aceptado (2026-09-30)
- **Tarea:** C1 de [`tasks/todo.md`](../../tasks/todo.md)

## Contexto

La app corre en Vercel (Node.js 24, Fluid Compute) sobre Postgres en Neon. Necesitamos transacciones interactivas (reordenar áreas reescribe `sort_order` de todas en una sola transacción) y migraciones versionadas que se apliquen solas en cada despliegue a producción.

La guía de Neon para Vercel recomienda `node-postgres` con Fluid Compute y `attachDatabasePool` de `@vercel/functions`: las instancias se reutilizan entre peticiones, así que un pool de conexiones TCP normal es lo más eficiente, y `attachDatabasePool` mantiene viva la instancia hasta liberar las conexiones inactivas.

## Decisión

- **Driver:** `pg` (node-postgres) + Drizzle (`drizzle-orm/node-postgres`).
- **Cliente:** `src/lib/db.ts` crea un `Pool` de forma perezosa con `getDb()` (el build nunca necesita base de datos), con `idleTimeoutMillis` explícito, y llama a `attachDatabasePool(pool)`. Fuera de producción el cliente se guarda en `globalThis` para sobrevivir al *hot reload*. Con un host no local se fuerza TLS verificado (`ssl: { rejectUnauthorized: true }`).
- **Conexiones:** la app usa `DATABASE_URL` (*pooled*, PgBouncer de Neon). Las migraciones y el seed usan **solo** `DATABASE_URL_UNPOOLED` (directa), sin volver a `DATABASE_URL`.
- **Migraciones:** `pnpm db:generate` (drizzle-kit) en local. El `buildCommand` de `vercel.json` (`scripts/vercel-build.sh`) corre `pnpm db:migrate` solo cuando `VERCEL_ENV=production` y después `next build`. Si la migración falla, falla el despliegue.
- **Protección local:** `db:migrate` y `db:seed` se niegan a tocar un host no local salvo en el build de Vercel (`VERCEL=1`) o con `ALLOW_PROD_DB=1`, y muestran el host y la base (nunca credenciales) antes de escribir.
- **`updated_at`:** Drizzle lo sella con `now()` de la base en cada `update`. Los `UPDATE` en SQL crudo deben ponerlo ellos mismos.
- **Pruebas:** Postgres 17 desechable (Docker en local, servicio en GitHub Actions) con `TEST_DATABASE_URL`, que solo acepta un host local, una base terminada en `_test` y una URL distinta de las de la app. Nunca la base de producción.

## Consecuencias

- Las transacciones interactivas (`db.transaction`) funcionan igual en local, en CI y en producción; una prueba de integración lo verifica.
- Un solo driver para la app, los scripts y las pruebas; nada específico de Neon en el código.
- `pg` no funciona en el runtime Edge. Todo lo que toque la base corre en el runtime de Node.js.
- El PgBouncer de Neon trabaja en modo transacción: no se usan `SET`, `LISTEN/NOTIFY` ni sentencias preparadas con nombre sobre `DATABASE_URL`.

## Alternativas

- **`@neondatabase/serverless` por HTTP (`neon-http`):** menor latencia en consultas sueltas, pero no admite transacciones interactivas. Descartado.
- **`@neondatabase/serverless` por WebSocket (`neon-serverless`):** admite transacciones, pero está pensado para entornos sin reutilización de instancias (Edge, otros serverless). Con Fluid Compute agrega una dependencia específica de Neon sin beneficio frente a `pg`.
