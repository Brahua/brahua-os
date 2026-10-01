# ADR-006: CI/CD trunk-based con GitHub Actions como único deployer

- **Estado:** aceptado (2026-10-01)
- **Tareas:** C0 y mejoras de proceso · PRs [#8](https://github.com/Brahua/brahua-os/pull/8), [#22](https://github.com/Brahua/brahua-os/pull/22) · respaldos: C10

## Contexto

La app corre en Next.js 16 sobre Vercel (Node.js 24, Fluid Compute) con Postgres en Neon. Durante el MVP hay un solo ambiente, producción (`https://os.brahua.com`), y trabajan agentes que abren PRs en paralelo. Hacía falta que nada llegue a producción sin pasar todas las pruebas, que las migraciones se apliquen solas y que una falla en producción se note.

Restricciones que salieron en el camino:

- Las variables de Neon (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`) son **Sensitive** en Vercel: solo existen dentro del build y del runtime de Vercel. `vercel pull` las entrega como `[sensitive]`, así que no se puede construir en el runner de GitHub (incidente del 2026-10-01: la migración falló con "Invalid URL").
- El repo es privado en el plan gratuito de GitHub: no hay protección de rama ni rulesets.

## Decisión

- **Trunk-based:** una rama corta por cambio (`feat/…`, `fix/…`, `chore/…`, `docs/…`) y un PR contra `main`. Nunca push directo a `main`.
- **`ci.yml`** corre en cada PR y en cada push a `main`: formato, design system, lint, tipos, unitarias, build; E2E (Playwright + axe) en la imagen de Playwright con un Postgres de servicio; integración contra otro Postgres de servicio, con la comprobación de que el esquema y las migraciones están sincronizados. Las pruebas nunca tocan la base de producción.
- **GitHub Actions es el único deployer:** el auto-deploy de Git de Vercel está desactivado (`vercel.json`). El job `deploy` corre solo en `push` a `main` y solo si pasaron los tres checks.
- **Build remoto en Vercel:** `vercel deploy --prod` sube el checkout y Vercel ejecuta `scripts/vercel-build.sh` (`auth:check-env`, `db:migrate`, `db:seed`, `next build`). Ahí sí existen las variables Sensitive. Si la migración falla, falla el deploy.
- **Smoke test** de solo lectura (`scripts/smoke-production.sh`) después de cada deploy, cuando el dominio ya apunta al deploy nuevo. `deploy` y `smoke` comparten un grupo de concurrencia con `queue: max`: un deploy a la vez y ninguno se pierde.
- **`main` sin protección, aceptado por el owner (2026-10-01):** la regla "merge solo con CI verde" se cumple por proceso (se revisan los tres checks antes de cada merge) y el deploy exige igual que el run del push pase todo.
- **Higiene de workflows:** acciones fijadas a un SHA completo con la versión en un comentario (Dependabot propone las subidas), `permissions` mínimos, `timeout-minutes` en cada job y grupos de concurrencia.
- **Respaldos (C10):** `backup.yml` hace un `pg_dump` semanal con un rol de solo lectura de Neon (`backup_ro`), sin los datos de las tablas `auth_*`, lo cifra con `age` para la llave pública del owner (`BACKUP_AGE_RECIPIENT`) y guarda solo el cifrado como artefacto privado del workflow (90 días). La llave privada vive solo en el gestor de contraseñas del owner. `BACKUP_DATABASE_URL` solo se entrega a los pasos de `target=production`, que solo corre en `main`. Los secretos solo los carga el owner desde una terminal propia; nunca pasan por la sesión de un agente.

## Alternativas

- **Integración Git de Vercel (deploy en cada push):** despliega aunque fallen las pruebas de GitHub y no permite encadenar el smoke test.
- **`vercel pull` + `vercel build --prebuilt` en el runner:** imposible con variables Sensitive (llegan como `[sensitive]`).
- **Volver las variables de Neon no Sensitive:** las expondría a cualquiera con acceso a la CLI o al panel; se descartó a cambio de construir en Vercel.
- **GitHub Pro para proteger `main`:** costo mensual que el owner decidió no asumir durante el MVP.
- **Respaldo sin cifrar (solo artefacto privado):** cualquiera con lectura del repo o un token con permisos de Actions lo bajaría. Con `age` solo la llave privada del owner lo abre, a cambio de que **perder esa llave es perder todos los respaldos**.
- **Ambientes de preview con ramas de Neon:** más costo y complejidad; las passkeys tampoco funcionan fuera del dominio de producción.

## Consecuencias

- Producción siempre corresponde a un commit de `main` que pasó todos los checks.
- Una migración rota no publica nada: el build de Vercel falla y producción sigue con el deploy anterior.
- El runner de GitHub nunca ve las credenciales de la app. La única credencial de base de datos en GitHub es `BACKUP_DATABASE_URL`: no puede escribir, pero **sí lee todos los datos que no son de autenticación** (hoy las áreas; mañana, todo lo que agreguen los módulos). `VERCEL_TOKEN` es más poderoso todavía: puede desplegar código que lea las credenciales de la app en el runtime de Vercel.
- **Riesgo aceptado (repo privado en el plan gratuito):** sin protección de rama ni *environments* con reglas de rama, cualquiera con permiso de push puede correr un workflow desde una rama propia, editado para leer `BACKUP_DATABASE_URL` o `VERCEL_TOKEN`. El chequeo de `main` en `backup.yml` evita usos accidentales, no a alguien con push. Hoy el único con push es el owner (y los agentes que trabajan en su nombre); dar push a otra persona equivale a darle esos secretos. Se revisa si el repo pasa a un plan con *environments* protegidos.
- Sin protección de rama, la disciplina de merge depende del proceso (y de que los agentes lo respeten).
- Sin previews, los cambios visuales se revisan con las capturas de la E2E y en producción.
