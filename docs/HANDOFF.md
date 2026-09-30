# Traspaso entre sesiones

> Punto de entrada para retomar el trabajo en una sesión nueva. Se actualiza al cerrar cada tarea o sesión.
> Última actualización: 2026-09-30.

## Cómo retomar

1. Leer este archivo, `CLAUDE.md`, `tasks/todo.md` y la spec del módulo en curso (`SPEC-core.md`).
2. Ejecutar `gh auth switch -u Brahua`: en la sesión, RTK llama al binario `gh` sin el wrapper del `~/.zshrc` del usuario, así que manda la cuenta activa del llavero. No tocar el `.zshrc`.
3. Seguir el flujo autónomo acordado (ver memoria `modo-autonomo`):
   - Implementador (subagente, worktree) → PR.
   - Revisores en paralelo: `code-reviewer`, `test-engineer` y `security-auditor` si toca auth, datos o secretos; accesibilidad si toca UI.
   - Correcciones → CI verde → merge → deploy automático.
   - Parar y reportar al usuario **al final de cada módulo**.

## Estado

- **design-system:** ✅ completado. Fuente de verdad en Claude Design (skill `design-sync-pull`).
  - Los 2 ajustes locales (foco en claro y texto blanco en teclas naranjas) ya están en Claude Design; `overrides.css` quedó vacío (sincronizado el 2026-09-30).
- **core:** en curso.
  - ✅ C0: producción en https://os.brahua.com; deploy desde GitHub Actions solo con todos los checks en verde.
  - ✅ C1 (base de datos): PR #10 integrado; la primera migración (`core_life_areas`) se aplicó en producción el 2026-09-30.
  - ✅ Seed en producción: `scripts/vercel-build.sh` ejecuta `pnpm db:seed` (idempotente) después de `db:migrate` en cada build de producción.
  - ✅ C2a (contraseña, protección y owner): PR #14 integrado; login con contraseña en producción.
  - 🟡 C2b (passkey): PR `feat/core-c2b-passkey` abierto, **sin merge**. Pendiente: revisores (`code-reviewer`, `test-engineer`, `security-auditor`, accesibilidad). No necesita variables nuevas. Después del deploy: Checkpoint 1 en dispositivos reales (ver abajo).
  - Siguiente: C3 (navegación).

## C2a: pasos del usuario (en orden)

Los secretos nunca pasan por la sesión del agente: todo esto se hace en una terminal normal o en el panel de Vercel.

1. **Variables en Vercel → brahua-os → Settings → Environment Variables, solo en _Production_** (marcar como _Sensitive_):

   | Variable | Valor |
   |---|---|
   | `BETTER_AUTH_SECRET` | Aleatorio, ≥ 32 caracteres: `openssl rand -base64 32` |
   | `BETTER_AUTH_URL` | `https://os.brahua.com` |
   | `OWNER_EMAIL` | `josuebh62@gmail.com` |

   `DATABASE_URL` y `DATABASE_URL_UNPOOLED` ya existen (Neon). Sin las tres nuevas, `scripts/vercel-build.sh` corta el build de producción con `pnpm auth:check-env` antes de migrar: el deploy falla en vez de publicar una app sin login posible.
2. **Merge del PR.** El build aplica la migración `0001_core_auth` (solo crea tablas `auth_*`; aditiva).
3. **Crear el owner** contra producción, desde tu terminal, en la raíz del repo:

   ```bash
   # DATABASE_URL_UNPOOLED: la conexión directa de Neon (Vercel → Storage → brahua-os-db, o `vercel env pull`).
   OWNER_EMAIL=josuebh62@gmail.com DATABASE_URL_UNPOOLED='postgresql://…' ALLOW_PROD_DB=1 pnpm auth:owner
   ```

   Como la base es remota, primero pide escribir su host para confirmar (solo `ALLOW_PROD_DB=1` lo habilita; `VERCEL=1` no cuenta). Luego pide la contraseña dos veces sin mostrarla (mínimo 12 caracteres); Ctrl-C o Ctrl-D cancelan. Volver a ejecutarlo **resetea** la contraseña, cierra todas las sesiones y **borra todas las passkeys** (desde C2b): es la única forma de recuperar el acceso. Después hay que registrar las passkeys de nuevo.
4. Entrar en https://os.brahua.com/login.

## Cómo funciona el login (C2a)

- `src/lib/auth.ts`: Better Auth con Drizzle (`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_rate_limits`), `disableSignUp`, contraseña de 12 a 128 caracteres, sesión de 30 días que se renueva una vez al día, cookies `HttpOnly` + `SameSite=Lax` + `Secure` en producción.
- Solo el owner: un hook rechaza cualquier otro email en `/sign-in/email` con el mismo error que una contraseña incorrecta, y un hook de base de datos impide crear sesiones de otros usuarios (sirve también para la passkey de C2b). `requireOwner()` vuelve a comprobar el email en cada página.
- Renovación de la sesión: los Server Components solo leen la sesión (`disableRefresh`), porque no pueden escribir cookies. `SessionRefresher` (en el layout de `(app)`) llama a `/api/auth/get-session` desde el navegador en cada carga; si la sesión tiene más de un día, el handler extiende la expiración y reescribe la cookie (30 días más).
- Rate limit en la tabla `auth_rate_limits`: 5 intentos por minuto e IP en `/sign-in/email`; el sexto devuelve 429. Cuenta todos los intentos, no solo los fallidos, y sin importar el email. `/get-session` no tiene rate limit (no escribe en cada carga). La IP sale de `x-forwarded-for` (explícito en `advanced.ipAddress`), que Vercel sobrescribe con la IP real; las peticiones sin IP no quedan exentas: comparten un único contador (`no-trusted-ip`).
- Enumeración: cualquier cosa que no sea el email exacto del owner con una contraseña de hasta 128 caracteres recibe el mismo 401 que una contraseña incorrecta.
- Cabeceras de seguridad en `next.config.ts` para todas las rutas (adelantadas de C7).
- `/login` es la única página pública. Todo `(app)` (incluidos `/` y `/design`) exige sesión del owner: layout + cada página llaman `requireOwner()`.
- E2E: `e2e/global-setup.ts` prepara la base desechable (`TEST_DATABASE_URL`) con un owner de prueba; `e2e/auth.setup.ts` inicia sesión por el formulario y guarda la sesión para el resto. En local: `docker compose up -d` y luego `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/brahua_os_test pnpm test:e2e`, o `pnpm test:e2e:docker` (capturas; usa `host.docker.internal`).

## Cómo funciona la passkey (C2b)

- Plugin: en Better Auth 1.7 la passkey es un paquete aparte, `@better-auth/passkey` (fijado a la misma versión que `better-auth`); el cliente es `@better-auth/passkey/client`. Tabla `auth_passkeys` (migración `0002_core_auth_passkeys`, aditiva). Solo guarda la llave pública.
- Relying party: `rpID`, `rpName` (`brahua-os`) y `origin` salen de `BETTER_AUTH_URL` (`passkeyRelyingParty` en `src/lib/auth-env.ts`), nunca de la petición. Producción: `os.brahua.com`; desarrollo y pruebas: `localhost`. En producción `BETTER_AUTH_URL` tiene que ser exactamente `https://os.brahua.com` (si no, `auth:check-env` corta el build): una passkey queda atada para siempre al dominio donde se creó. Por eso no funcionan en previews.
- Entrar: `/login` tiene "Entrar con passkey" y, si el navegador lo soporta, ofrece la passkey en el autocompletado del campo Email (`autocomplete="username webauthn"`, *conditional UI*). Las credenciales son *discoverable* (`residentKey: "required"`): no hace falta escribir el email.
  - La ceremonia la ejecuta `src/lib/passkey-sign-in.ts` paso a paso (no `authClient.signIn.passkey`). Cada intento (autocompletado o botón) lleva un número y solo el último actúa: un intento viejo nunca abre el aviso del navegador, porque abrirlo cancelaría el del intento nuevo.
  - Cerrar el aviso del navegador (`NotAllowedError` o `ERROR_CEREMONY_ABORTED`) no muestra nada. `AUTH_CANCELLED` de Better Auth **no** cuenta como cancelación: su cliente lo usa también para errores de red.
  - Tras un 429 no se reinicia el autocompletado; tras un rechazo, sí. Al elegir una passkey del autocompletado, el botón muestra "Entrando…".
  - Sin WebAuthn, el botón queda con `aria-disabled` y la explicación en `aria-describedby`, alcanzable con Tab. Mientras se espera, los botones usan `aria-disabled` (no `disabled`) para no perder el foco.
- Verificación de usuario obligatoria: `userVerification: "required"` al registrar y en el cliente al entrar (el plugin pide "preferred" y no se puede configurar). Además, hooks `afterVerification` rechazan cualquier registro o inicio de sesión sin UV (400 `FAILED_TO_VERIFY_REGISTRATION` / 401 `AUTHENTICATION_FAILED`): con la passkey como único factor, tiene que probar quién tiene el dispositivo.
- Solo el owner: la passkey de otro usuario se verifica, pero el hook de base de datos de sesiones la rechaza (500 `UNABLE_TO_CREATE_SESSION`, sin cookie). Probado en `tests/integration/auth-passkey.test.ts` con un autenticador por software (`tests/integration/support/software-authenticator.ts`).
- Cambiar passkeys (registrar, renombrar, eliminar) exige una sesión creada hace **menos de 10 minutos** (hook `before` en `auth.ts`, 403 `SESSION_NOT_FRESH`); la UI pide volver a entrar con la contraseña. El nombre es solo una etiqueta: se registra sin `name` (que el plugin usaría como nombre de cuenta en el llavero; ahí queda el email) y luego se pone con `update-passkey`, máximo 50 caracteres (también validado en el servidor).
- Recuperación: `pnpm auth:owner` borra las passkeys del owner en la misma transacción que cierra sus sesiones, y dice cuántas borró.
- **Provisional:** registrar, listar (nombre + fecha de creación en hora de Lima) y eliminar (con confirmación dentro de la página) está en la portada, junto a "Cerrar sesión". C4 solo lo mueve a `/settings`.
- Rate limit (base de datos, por IP): `/passkey/verify-authentication` 5 por minuto (como la contraseña); `/passkey/generate-authenticate-options`, `/passkey/generate-register-options` y `/passkey/verify-registration` 10 por minuto (los de opciones escriben un desafío y el de registro, una passkey). El plugin no trae reglas propias.
- Contador de firmas: si baja (posible clon), `@simplewebauthn/server` rechaza el inicio de sesión y el plugin lo registra como error ("Failed to verify authentication"). No hay registro de seguridad aparte.
- E2E: `e2e/passkey.spec.ts` usa el autenticador virtual de Chromium por CDP (`WebAuthn.addVirtualAuthenticator`): contraseña → registrar → cerrar sesión → entrar con passkey, y axe en ambos temas.
- `pnpm auth:owner` valida `DATABASE_URL_UNPOOLED` antes de cualquier pregunta: tiene que ser `postgres://` o `postgresql://` con un host real y una base (rechaza marcadores como `…`). `channel_binding` en la URL se acepta: `pg` lo ignora.
- Sin verificar todavía: comportamiento en iPhone y Android reales, y dentro de la PWA instalada (C7). Es parte del Checkpoint 1.

## Decisiones recientes a respetar

- Driver: `pg` + Drizzle + `attachDatabasePool` (ADR-002). Migraciones con `DATABASE_URL_UNPOOLED`.
- Base Neon con variables **solo en Production**. Las pruebas usan Postgres desechable (Docker en local, servicio en CI), nunca producción.
- Secretos: `gh secret set` desde el `!` de la sesión los guarda vacíos; el usuario debe usar una terminal normal.
- Diseño de pantallas nuevas: los hago yo con el design system, tomando como referencia las pantallas del proyecto de Claude Design; el usuario revisa en los checkpoints.
- Auth: la sesión se verifica en el layout de `(app)` **y** en cada página, acción y query con `requireOwner()`, nunca solo en un proxy. El inicio de sesión va por el handler HTTP (cliente de Better Auth), no por `auth.api` en una Server Action, para que aplique el rate limit.
- Workflows multiagente: no usarlos en `core`. Proponerlos con un costo estimado para las specs en lote o para módulos paralelos.
