# ADR-001: Autenticación de un solo usuario

- **Estado:** aceptado (2026-09-30)
- **Tareas:** C2a y C2b de [`tasks/todo.md`](../../tasks/todo.md) · PRs [#14](https://github.com/Brahua/brahua-os/pull/14), [#16](https://github.com/Brahua/brahua-os/pull/16), [#17](https://github.com/Brahua/brahua-os/pull/17)

## Contexto

brahua-os es la app personal de una sola persona (el owner) y está publicada en internet (`https://os.brahua.com`). Nadie más debe poder registrarse ni ver un dato aunque conozca la URL, la sesión tiene que durar semanas en el celular y los datos de identidad tienen que quedarse en la propia base (Neon), sin un proveedor externo de identidad.

## Decisión

- **Better Auth** (`better-auth` + `@better-auth/passkey`, versiones fijas) sobre Drizzle, con tablas propias renombradas a `auth_*` (`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_rate_limits`, `auth_passkeys`).
- **Owner único:**
  - `emailAndPassword.disableSignUp: true`: no hay registro. El owner solo se crea o se resetea con `pnpm auth:owner`, desde una terminal y con `ALLOW_PROD_DB=1` más la confirmación del host (un build de Vercel no cuenta como permiso).
  - Un hook rechaza en `/sign-in/email` cualquier email distinto de `OWNER_EMAIL` con el mismo error que una contraseña incorrecta, y un hook de base de datos impide crear sesiones de otro usuario (también con passkey).
  - `requireOwner()` vuelve a comprobar el email en el layout de `(app)`, en cada página y en cada query; las Server Actions pasan por `ownerAction()`. Nunca solo en un proxy.
- **Contraseña** de 12 a 128 caracteres, con rate limit en la base (5 intentos por minuto e IP en `/sign-in/email`; el almacenamiento en memoria no sirve en serverless).
- **Passkey** con `residentKey: "required"` y **verificación de usuario obligatoria** (`userVerification: "required"`, y hooks `afterVerification` que rechazan cualquier registro o inicio de sesión sin UV): como la passkey es el único factor, tiene que probar quién tiene el dispositivo. El relying party (`os.brahua.com`) sale de `BETTER_AUTH_URL`, nunca de la petición. Cambiar passkeys exige una sesión de menos de 10 minutos.
- **Sesión** de 30 días que se renueva una vez al día; cookies `HttpOnly`, `Secure` y `SameSite=Lax`.
- **Recuperación:** volver a correr `pnpm auth:owner`, que cambia la contraseña, cierra todas las sesiones y borra las passkeys. No hay reseteo por email.

## Alternativas

- **Auth.js / NextAuth:** sin passkeys de primera clase ni rate limit en base de datos; habría que construir más piezas.
- **Proveedor gestionado (Clerk, Neon Auth, Auth0):** resuelve el login, pero deja la identidad fuera de la base propia, agrega un servicio externo para un solo usuario y en general asume registro abierto.
- **Solo un enlace mágico por email:** depende de un proveedor de correo y de la bandeja de entrada para cada inicio de sesión.
- **Protección de Vercel (Deployment Protection) o autenticación básica:** no da sesión de semanas en la PWA ni passkeys, y no sirve para autorizar Server Actions.

## Consecuencias

- La superficie pública es solo `/login` y `/api/auth/*`; todo lo demás exige la sesión del owner.
- Las passkeys solo funcionan en el dominio de producción: los previews no sirven para probarlas (se prueban con el autenticador virtual de Chromium en la E2E y con un autenticador por software en integración).
- Perder el acceso se arregla solo desde una terminal con la conexión directa a la base; es intencional.
- Los datos de las tablas `auth_*` (hash de la contraseña, sesiones, passkeys, verificaciones, rate limits y el usuario) no salen de la base: `pnpm db:export` no las incluye y el `pg_dump` semanal guarda solo su definición (`--exclude-table-data='public.auth_*'`). Después de restaurar un respaldo, la base queda sin owner: se corre `pnpm auth:owner` y se registran de nuevo las passkeys en Ajustes.
