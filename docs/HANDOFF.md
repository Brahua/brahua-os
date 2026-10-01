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
  - Los ajustes locales están en Claude Design: foco en claro y teclas naranjas (2026-09-30); tooltip, barra inferior a 320 px, switch con movimiento reducido y colores forzados (2026-10-01). `overrides.css` está vacío.
- **core:** en curso.
  - ✅ C0: producción en https://os.brahua.com; deploy desde GitHub Actions solo con todos los checks en verde.
  - ✅ C1 (base de datos): PR #10 integrado; la primera migración (`core_life_areas`) se aplicó en producción el 2026-09-30.
  - ✅ Seed en producción: `scripts/vercel-build.sh` ejecuta `pnpm db:seed` (idempotente) después de `db:migrate` en cada build de producción.
  - ✅ C2a (contraseña, protección y owner): PR #14 integrado; login con contraseña en producción.
  - ✅ C2b (passkey): PRs #16 y #17 integrados y en producción.
  - ✅ Checkpoint 1 (2026-09-30): el owner entra con contraseña y con passkey (Touch ID en el computador, Face ID en el celular).
  - ✅ Confirmado por el owner (2026-09-30): el tema **oscuro por defecto** es el correcto, y revisó la navegación en su celular real: bien, incluidas las zonas seguras (notch e indicador de inicio).
  - ✅ C3 (navegación): PR #19 integrado.
  - ✅ C4 (ajustes): PR #20 integrado.
  - ✅ C5 (áreas: ver y crear): PR #21 integrado.
  - 🟡 Mejoras de proceso (PR `chore/faster-e2e`, **sin merge**): E2E nativa sin Docker, capturas generadas en GitHub, menos capturas, smoke test después del deploy y registro de errores sin mensajes de Postgres. Ver "Pruebas E2E" y "Smoke test en producción".
  - 🟡 C6 (áreas: reordenar y archivar): PR `feat/core-c6-areas-order`, **sin merge** (pendiente de revisión). Ver "Cómo funcionan el orden y el archivo (C6)".
  - 🟡 C7 (PWA): PR `feat/core-c7-pwa`, **sin merge** (pendiente de revisión). Falta instalarla en el iPhone. Ver "Cómo funciona la PWA (C7)".
  - 🟡 C8 (páginas de error): PR `feat/core-c8-error-pages`, **sin merge** (pendiente de revisión). Ver "Cómo funcionan las páginas de error (C8)".
  - 🟡 C10 (operación): PR `feat/core-c10-operations`, **sin merge** (pendiente de revisión): `pnpm db:export`, respaldo semanal con `pg_dump` (`backup.yml`) y ADRs 001–007. **Acción del owner pendiente:** crear el rol de solo lectura y el secreto `BACKUP_DATABASE_URL` (ver "Respaldos (C10)"); hasta entonces el respaldo semanal falla con un error que apunta ahí.
  - Siguiente: Checkpoint 2 (recorrido completo con el owner), que incluye instalar la PWA en el iPhone (C7).

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
- E2E: `e2e/global-setup.ts` prepara la base desechable (`TEST_DATABASE_URL`) con un owner de prueba; `e2e/auth.setup.ts` inicia sesión por el formulario y guarda la sesión para el resto. Cómo correrlas: ver "Pruebas E2E".

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
- Registrar, listar (nombre + fecha de creación en hora de Lima) y eliminar (con confirmación dentro de la página) está en Ajustes (`/settings`), junto a "Cerrar sesión" (desde C4; antes, en la portada).
- Rate limit (base de datos, por IP): `/passkey/verify-authentication` 5 por minuto (como la contraseña); `/passkey/generate-authenticate-options`, `/passkey/generate-register-options` y `/passkey/verify-registration` 10 por minuto (los de opciones escriben un desafío y el de registro, una passkey). El plugin no trae reglas propias.
- Contador de firmas: si baja (posible clon), `@simplewebauthn/server` rechaza el inicio de sesión y el plugin lo registra como error ("Failed to verify authentication"). No hay registro de seguridad aparte.
- E2E: `e2e/passkey.spec.ts` usa el autenticador virtual de Chromium por CDP (`WebAuthn.addVirtualAuthenticator`): contraseña → registrar en `/settings` → cerrar sesión → entrar con passkey, y axe en ambos temas.
- `pnpm auth:owner` valida `DATABASE_URL_UNPOOLED` antes de cualquier pregunta: tiene que ser `postgres://` o `postgresql://` con un host real y una base (rechaza marcadores como `…`). `channel_binding` en la URL se acepta: `pg` lo ignora.
- Verificado en dispositivos reales (Checkpoint 1): Touch ID en el computador y Face ID en el iPhone. Falta probarla dentro de la PWA instalada (C7).

## Cómo funciona la navegación (C3)

- **Registro:** `src/lib/modules.ts` define `ModuleManifest` (`id`, `label`, `icon`, `href`, `navOrder`, `navGroup` `main`/`footer`, `shortcut` 1–8, `status` `available`/`planned`) y la lista `MODULES`. `navItems()` ordena primero `main` y luego `footer` (cada grupo por `navOrder`), descarta los `planned` y rechaza ids, hrefs o atajos duplicados. El atajo es **fijo por módulo** (Hoy = 1, Áreas = 7, Ajustes = 8), así que no se corre cuando aparecen otros. Los manifiestos son client-safe (solo datos e ícono). Los de `core` están en `src/modules/core/module.ts`: Hoy (`/`), Áreas (`/areas`, desde C5) y Ajustes (`/settings`, desde C4), todos disponibles.
- **Componentes** (`src/modules/core/components/`; son patrones de `core`, no del design system):
  - `Sidebar`: `<header>` (landmark banner) con marca, botón contraer/expandir, tecla de captura y dos `<nav>` ("Principal" y "Secundaria"). Contraída, cada enlace tiene tooltip y conserva su nombre con `aria-label`. Prop `shortcuts` para mostrar u ocultar las pistas de teclado.
  - `BottomNav`: 5 celdas con la captura al centro; con más de 4 secciones, las 3 primeras + "Más". "Más" abre `MoreSheet` (cargado con `next/dynamic` solo si hace falta), con `<nav aria-label="Más secciones">`; el foco vuelve a "Más" al cerrar (`returnFocusRef` del `Sheet`, por Safari). "Más" no usa `aria-current`: si la sección actual está dentro, su nombre es "Más (actual: X)" y se marca con `data-active`. El ítem actual lleva un punto debajo (no solo color). Las etiquetas se truncan en pantallas angostas; el nombre completo va en `aria-label`.
  - `AppNav`: decide qué se ve por CSS (`lg:`), guarda el estado colapsado y escucha los atajos. `[`, `1`–`8` y ⌥ + número (por `event.code`) solo actúan desde 1024 px. Ningún atajo actúa dentro de inputs de texto, textareas, selects, contenteditable, ni widgets con rol propio (textbox, searchbox, combobox, listbox, menu, grid, tree, slider, spinbutton) o diálogos; tampoco con ⌘/Ctrl/Shift. La excepción es `[` con ⌥ o AltGr, porque los teclados en español lo necesitan para escribirlo (`src/lib/shortcuts.ts`). Un número de la página actual no vuelve a navegar.
- **Preferencias por dispositivo** (`src/modules/core/nav-preferences.ts`, cookies de 1 año leídas por el layout en el servidor, sin parpadeo):
  - `bo_sidebar`: contraída o no. Solo se escribe al cambiarla, nunca al montar.
  - `bo_shortcuts`: `off` apaga los atajos de una tecla (WCAG 2.1.4); por defecto están activos. Apagados: sin listener, sin `Kbd` ni `aria-keyshortcuts`. El interruptor está en Ajustes (C4).
- **Captura:** la tecla se muestra (para que el diseño no cambie cuando llegue) pero con `aria-disabled`, alcanzable con Tab y con el tooltip "Próximamente" como descripción. Como en táctil no hay hover, tocarla muestra el tooltip 2 segundos. Cuando exista la captura rápida, se pasa `onCapture` a `BottomNav`/`Sidebar` y se agrega el atajo `C`.
- **Layout** (`src/app/(app)/layout.tsx`): enlace "Saltar al contenido" (respeta la zona segura), `<main id="content">` con las zonas seguras (`viewport-fit=cover` solo en `(app)`) y el espacio de la barra inferior (`--shell-bottom-offset`; `AppNav` lo ajusta a la altura real si la barra crece con texto más grande). `scroll-padding-bottom` en `<html>` bajo 1024 px para que el foco nunca quede tapado (WCAG 2.4.11). La hoja inferior también respeta las zonas seguras. Las páginas ya no ponen su propio `<main>` y cada una tiene su `metadata.title`.
- **Hora:** `src/lib/time.ts` usa `Intl` con `America/Lima` (sin dependencias nuevas; la hora sale de `formatToParts`): `greetingFor` (días desde las 5:00, tardes desde las 12:00, noches desde las 19:00), `formatLongDate` y `ownerDateKey`. La portada los calcula en el servidor, así que no hay desajuste de hidratación.
- **Claude Design:** los ajustes de `Tooltip` (WCAG 1.4.13), `BottomNav` a 320 px (WCAG 1.4.10), `Switch` con movimiento reducido (token `--duration-switch`) y teclas activadas en colores forzados ya están en Claude Design y se sincronizaron el 2026-10-01; `overrides.css` quedó vacío. Sigue pendiente subir a Claude Design el cambio de `sheet.tsx` (props `onClosed` y `bodyClassName`, C5), que es del componente y no de CSS.
- **Visto de paso, sin arreglar:** a 320 px, `/design` tiene desborde horizontal por secciones que ya existían (SectionLabel `w-80`, Lcd y ProgressRing). No es de la navegación.
- **E2E** (`e2e/home.spec.ts`):
  - Espera `data-nav-shortcuts="ready"` en `<html>` antes de pulsar teclas (los atajos existen solo tras hidratar).
  - Las pruebas negativas registran, con un listener propio puesto después del de `AppNav`, si alguien llamó a `preventDefault()`, y después comprueban que una tecla válida sí actúa. Así pueden fallar de verdad.
  - Los tamaños (`--sidebar-width`, `--bottom-nav-height`…) se leen de las variables CSS.
  - Las capturas de `/design` y de `/settings` ocultan la barra inferior fija (`e2e/support/hide-app-nav.css`).

## Cómo funcionan los ajustes (C4)

- `/settings` (`src/app/(app)/settings/`): `requireOwner()`, título "Ajustes · brahua-os" y cuatro secciones (`<section>` nombrada por su `SectionLabel` h2): Apariencia, Teclado, Passkeys y Sesión. Ajustes aparece en la navegación (pie de la barra lateral, atajo 8; en el celular, en la barra inferior).
- **Tema** (`theme-picker.tsx`): `SegmentedControl` en modo radio (flechas, Inicio y Fin) sobre `next-themes`, nombrado por el título visible "Apariencia" y descrito por la línea sobre "Sistema". **Oscuro por defecto** (`SPEC-design-system.md`, que prevalece en lo visual; `SPEC-core.md` se alineó en v2.3). La elección vive en `localStorage` (`theme`) y el script de next-themes la aplica antes de pintar, así que no hay parpadeo. El servidor no conoce el tema guardado: hasta montar, el grupo se dibuja invisible con un valor fijo (si no, la hidratación dejaría el `aria-checked` del servidor) y al montar se vuelve a crear (`key`) para que la opción elegida no se anime desde el valor provisional.
- **Atajos** (`shortcuts-switch.tsx`): `Switch` con un `<label>` visible (tocar el texto también lo cambia) y descripción. Escribe `bo_shortcuts` con `shortcutsCookie()` y llama a `router.refresh()`: el layout vuelve a leer la cookie en el servidor y `AppNav` quita (o vuelve a poner) el listener, los `Kbd` y los `aria-keyshortcuts` sin recargar la página.
- Passkeys y "Cerrar sesión": los mismos componentes de C2b, movidos a `settings/_components/`. "Cerrar sesión" usa `aria-disabled` (no `disabled`) mientras espera, para no perder el foco si falla. La portada solo tiene el saludo.
- E2E (`e2e/settings.spec.ts`): el tema persiste tras recargar en las tres opciones y un `MutationObserver` puesto antes de cargar comprueba que `<html>` nunca tuvo otro tema (sin parpadeo); "Sistema" con `emulateMedia({ colorScheme })`. La captura es la página entera sin la sección Passkeys (se oculta antes de capturar), porque la lista cambia con otras pruebas. Cerrar sesión se prueba en `login.spec.ts` y `passkey.spec.ts` con sesiones propias: hacerlo con la sesión compartida la cerraría para las demás pruebas.

## Cómo funcionan las áreas (C5)

- **Capas** (`src/modules/core/`):
  - `life-area-input.ts` (sin código de servidor): esquema Zod compartido por el cliente y el servidor, `normalizeAreaName` (NFC, espacios seguidos en uno, recortado), los mensajes (`LIFE_AREA_ERRORS`) y el tipo `LifeAreaSummary`. Nombre de 1 a 60 caracteres; se rechazan los caracteres de control y de formato (`\p{Cc}`, `\p{Cf}`: NUL, ancho cero, marcas bidireccionales; se permiten U+200C y U+200D para emoji como 👨‍👩‍👧) con un error en el campo, así que NUL nunca llega a Postgres. Campos ajenos (`slug`, `sortOrder`, `archivedAt`, `id` al crear) se descartan.
  - `life-area-limits.ts`: el largo máximo, compartido con el `CHECK` de la base.
  - `life-areas.ts` (`server-only`): acceso a datos; recibe `db` y confía en su input (`selectLifeAreas`, `insertLifeArea`, `updateLifeAreaById`). Devuelve `LifeAreaSummary`, nunca la fila completa.
  - `actions.ts` (`"use server"`): `createLifeArea(input: unknown)` y `updateLifeArea(input: unknown)` (con `id` en el mismo objeto), construidas con **`ownerAction(schema, handler, { name })`** (`src/lib/owner-action.ts`): sesión del owner primero (sin sesión, con cookie falsa o con otro email → error de autorización sin mirar el input), Zod, el handler, y cualquier excepción se registra en el servidor (JSON de una línea: nombre del error y `code`/`constraint` de la causa raíz; nunca un mensaje, ni el de Drizzle, que trae los parámetros, ni el de Postgres, que a veces cita el valor (p. ej. un uuid inválido), ni `detail`) y vuelve como error genérico. Un `id` que no existe es un error, no un insert. Es el patrón para los próximos módulos (documentado en `SPEC-core.md`).
  - `queries.ts` (`server-only`): `listLifeAreas({ includeArchived })`, con `requireOwner()` (redirige, porque la usan páginas).
  - `seed.ts`: las 8 áreas por defecto. **Sin `server-only`** a propósito: la importan `scripts/seed.ts` (tsx, en cada build de producción) y la E2E (Playwright), que no conocen la condición `react-server`, y no hay paquete `server-only` instalado (Next lo resuelve por dentro; Vitest lo apunta al módulo vacío de Next en `vitest*.config.mts`). No lo importa código de la app.
- **Base:** migración aditiva `0003_core_life_areas_checks` con `CHECK` de `color` y `icon` (generados desde `AREA_COLORS` y `AREA_ICON_NAMES`) y de `char_length(name)` entre 1 y 60. **Agregar un color o un ícono necesita `pnpm db:generate`** (cambia el `CHECK`).
- **Slug:** `slugify` (`src/lib/text.ts`) quita tildes y diéresis (ñ → n), pasa a minúsculas y deja solo `a-z0-9` separados por guiones; un nombre sin letras latinas ni dígitos (emoji, símbolos, otros alfabetos) da `area`. Si el slug ya existe (activas, archivadas o del seed) se agrega `-2`, `-3`… (`uniqueSlug`, reutiliza huecos: seguro mientras no haya borrado físico). **Editar nunca cambia el slug** ni la posición. Dos áreas pueden llamarse igual.
- **Orden y concurrencia:** una área nueva va al final (`max(sort_order) + 1`, archivadas incluidas). El insert corre en una transacción que toma `pg_advisory_xact_lock(hashtext('core_life_areas'))` (`LIFE_AREAS_LOCK`): dos creaciones simultáneas nunca eligen el mismo `sort_order` ni slug. **C6 debe tomar el mismo lock al reordenar.** Los escritores sin el lock (seed, importadores) pueden ganar la carrera del slug: el insert detecta la violación de `core_life_areas_slug_unique` y reintenta (hasta 3 veces). Ambos casos tienen prueba de integración real.
- **Pantalla** (`src/app/(app)/areas/`): `AreasManager` (cliente) dibuja la cabecera (título, cantidad y "Nueva área"), la lista (`<ul>` con `ListRow` botón, nombre accesible "Editar X"; los nombres largos ocupan hasta 2 líneas y el completo va en `title`) o el estado vacío. `AreaSheet` se carga con `next/dynamic` al abrir por primera vez. La hoja es inferior bajo 1024 px y lateral desde ahí. Una área nueva empieza **sin color ni ícono elegidos** (se distinguen por el ícono: elección explícita).
  - Color e ícono usan `RadioGrid` (`src/modules/core/components/radio-grid.tsx`): `radiogroup` nombrado por su etiqueta visible, una sola parada de Tab, la selección sigue al foco, ←/→ con vuelta, ↑/↓ por filas según el layout real, Inicio/Fin. Con error, la descripción va en el grupo y también en el radio que recibe el Tab. Los íconos tienen `title` (tooltip) y el nombre del elegido se ve junto a la etiqueta "Ícono"; el grupo se describe con "Usa las flechas para moverte por filas y columnas.".
  - La vista previa (`AreaTag`) es `sticky` arriba del cuerpo de la hoja, con `scroll-padding-top` en el cuerpo (`bodyClassName` del `Sheet`) para que el foco nunca quede debajo (WCAG 2.4.11). Con menos de 500 px de alto deja de ser `sticky` (y sin el padding), para no ocupar la pantalla (E2E a 320×256).
  - Al enviar, el cliente valida con el mismo esquema. Los errores van en cada campo (`aria-invalid`, `aria-describedby`) y el foco pasa al primero inválido. Errores sin campo visible: arriba en un `role="alert"`, con el mensaje propio de ese campo (p. ej. el del `id`) o el general (sesión, red).
  - **Mientras guarda**, la hoja no se cierra (Esc, el fondo, ✕ y Cancelar no hacen nada; Cancelar y Crear usan `aria-disabled`). Además `AreasManager` descarta un resultado que no es de la apertura actual (`editor.key`).
  - Al guardar: `revalidatePath("/areas")`, la hoja se cierra, el foco vuelve a "Nueva área" o a la fila editada, y **cuando la hoja terminó de cerrarse** (`onClosed`, nuevo en el `Sheet` del design system: después de la animación de salida, del foco y de quitar el `aria-hidden` que Radix pone en la página) una región `status` anuncia "Área «X» creada." o "Cambios guardados en «X».". Antes de eso el lector de pantalla no la leería. El aviso visible con "Deshacer" llega en C6.
- **E2E:** `e2e/global-setup.ts` siembra las 8 áreas. Las pruebas crean áreas con nombres únicos, nunca editan las sembradas y no suponen que la nueva es la última (otras pruebas crean en paralelo); las capturas de la lista ocultan las filas después de la 8 (`e2e/support/seeded-areas-only.css`). Un `MutationObserver` comprueba que el anuncio llega sin ancestros `aria-hidden` ni diálogo abierto.

## Cómo funcionan el orden y el archivo (C6)

- **Servidor** (`src/modules/core/`):
  - `life-area-order.ts` (sin código de servidor, lo usan el servidor y el cliente): `moveId`, `isSameIdSet`, `planReorder` (cada archivada conserva su lugar y las activas, en el orden recibido, llenan los demás; o `null` si la lista no es exactamente el conjunto de activas) y `applyOrder`.
  - `life-areas.ts`: `reorderLifeAreasByIds`, `archiveLifeAreaById` y `unarchiveLifeAreaById` toman `LIFE_AREAS_LOCK` (como `insertLifeArea`). Reordenar lee todas las áreas, valida con `planReorder` y escribe un solo `UPDATE … CASE` con las filas que cambian; `sort_order` queda contiguo (0…n-1). `updateLifeAreaById` solo edita activas (devuelve `"archived"` si está archivada). `selectArchivedLifeAreas`: las archivadas, la más reciente primero.
  - `actions.ts`: `reorderLifeAreas({ ids })`, `archiveLifeArea({ id })`, `unarchiveLifeArea({ id, position })` (`end` por defecto; `original` para Deshacer), todas con `ownerAction`. Una lista vieja o alterada → `LIFE_AREA_ERRORS.staleOrder`, sin escribir, pero con `revalidatePath` para que la respuesta traiga la lista actual. Editar una archivada → `LIFE_AREA_ERRORS.archived` (también revalida). Archivar o desarchivar dos veces no cambia nada.
  - `queries.ts`: `listArchivedLifeAreas()` (con `requireOwner()`). La página carga ambas listas en paralelo.
  - Sin migración: la tabla es chica y no hace falta índice.
- **Pantalla** (`src/app/(app)/areas/_components/`; bajo 360 px las filas ocultan el lápiz para dejarle espacio al nombre):
  - `area-rows.tsx`: las filas (`AreaRowContent`: asa "Mover X", el `ListRow` de editar y las `IconKey` "Subir X"/"Bajar X", sin tooltip porque la lista recorta con `overflow: hidden`) y `PlainAreas`, la lista sin dnd-kit. En los extremos las teclas usan `aria-disabled` (el foco se queda). Con una sola área, el asa también queda `aria-disabled`.
  - `sortable-areas.tsx`: la capa de dnd-kit, **cargada con `next/dynamic` (`ssr: false`)**. Mientras llega (y en el HTML del servidor), `PlainAreas` es su `loading`: mismas filas y Subir/Bajar ya funcionan; como `loading` no recibe props, las lee de `AreaListContext`. Si el foco estaba en la lista al cambiar, vuelve al mismo control. Asa con `aria-roledescription="elemento ordenable"` e instrucciones en español (que también nombran Subir y Bajar). Sensores: ratón (4 px), toque (200 ms de presión; el asa tiene `touch-action: manipulation`, así que deslizar sobre ella hace scroll) y teclado (`sortableKeyboardCoordinates`). Mientras hay una fila levantada, `<html data-dragging>` (`DRAGGING_ATTRIBUTE`): Esc y ⌘Z son del arrastre. Al soltar con el teclado, el foco vuelve al asa (también hacia abajo, cuando React reinserta el nodo). Anuncios propios; el inicio no se repite como movimiento y el resultado de soltar lo dice el aviso.
  - `ArchivedAreas`: `<section>` con un `<h2>` que contiene el botón de despliegue (`aria-expanded`, cantidad). Plegada por defecto. Filas de solo lectura con "Desarchivar" (en el celular, solo el ícono; el nombre accesible sigue siendo "Desarchivar X").
  - `AreaSheet`: "Archivar área" solo al editar, abajo del formulario, con la explicación como descripción. **Por qué en la hoja y no en cada fila:** archivar es poco frecuente y las filas ya tienen cuatro controles (asa, editar, subir, bajar); en la hoja está junto al área que afecta y con la explicación de qué significa.
  - `AreasManager`: `useOptimistic` con `applyAreasChange` (`areas-optimistic.ts`: `reorder` (renumera `sortOrder` en los lugares de las activas, como el servidor), `archive`, `unarchive` con `end` u `original`, robusto a una lista base más nueva). Cada cambio se aplica al instante y se guarda en una transición; si falla (o no hay red), vuelve atrás solo y un aviso "Sin guardar" dice por qué (el mensaje del servidor si es específico). **Las llamadas al servidor van en cola** (`saves`, una promesa en un `useRef`), Deshacer incluido: el último orden enviado es el que queda. Si falla un movimiento de una serie, el aviso con Deshacer solo se quita si era el último de la serie.
  - **Foco:** Subir/Bajar se quedan en la tecla de la fila movida; archivar desde la hoja devuelve el foco a la fila vecina (o a "Nueva área"); desarchivar lo pasa a la siguiente archivada o, si no quedan, a la fila restaurada; si un Deshacer quita la fila que tenía el foco, pasa a la vecina.
- **Avisos** (genéricos en `src/lib/toast/`; el visor en `core`):
  - `src/lib/toast/queue.ts`: cola pura (`toastReducer`: `push`, `replace` por id, `dismiss`; hasta 3 en espera; `tone: "error"`). `src/lib/toast/use-toaster.ts`: `useToaster()`. **Pendiente:** una sola cola para todo `(app)`, desde el layout, para que un aviso sobreviva a la navegación; hoy cada pantalla tiene la suya.
  - `src/modules/core/components/toast-viewport.tsx`: `<section aria-label="Avisos">` (región) con una región `role="status"` `aria-live="polite"` dentro, **siempre presente** (el `Toast` del design system ganó `live={false}` para no anidar regiones, y `actionProps`). Uno a la vez; nunca toma el foco. Si el aviso tiene acción, se lee además (oculto) "Para deshacer, pulsa Ctrl+Z o ⌘Z, o usa el botón Deshacer del aviso.". Vive en `core` y no en el design system porque depende del shell (barra inferior, `#content`, reglas de teclado, padding de scroll).
  - Tiempos (WCAG 2.2.1): 10 s con "Deshacer", 6 s sin acción, 12 s los errores; se pausan con el puntero encima, con el foco dentro, con un diálogo abierto (la hoja deja la región `aria-hidden`) y con la pestaña oculta, y siguen con el tiempo que quedaba. Esc lo cierra, desde dentro o desde la página (no en campos de texto, diálogos ni durante un arrastre). El foco nunca queda en `<body>`: después de "Deshacer", de Esc o si el aviso enfocado cambia desde el código, vuelve a donde estaba (o a `#content`). Además todo se puede rehacer sin límite de tiempo (mover de nuevo, desarchivar).
  - WCAG 2.4.11: mientras hay un aviso, un `ResizeObserver` pone su alto (más el margen) en `--toast-offset` de `<html>`, que se suma al `scroll-padding-bottom` (`extensions.css`) en todos los anchos: el foco nunca queda tapado por el aviso.
  - ⌘Z / Ctrl+Z ejecuta el "Deshacer" del aviso visible (`isUndoShortcut` en `src/lib/shortcuts.ts`): no dentro de campos de texto (ahí manda el deshacer del campo), widgets, diálogos ni durante un arrastre. El botón lo anuncia con `aria-keyshortcuts`.
  - Movimientos seguidos comparten un aviso ("«X» pasó al lugar N de M."); su "Deshacer" vuelve al orden de antes del primero, aplicado sobre las áreas de ahora (una creada o restaurada después queda al final).
  - Arriba de la barra inferior en el celular y abajo a la derecha desde 1024 px (`extensions.css`). Entra con una subida corta que con movimiento reducido es solo un fundido (`--motion-travel` es 0).
  - Ojo con las pruebas: React enlaza las transiciones asíncronas pendientes (incluso entre pruebas), así que una llamada que nunca termina impide ver cualquier vuelta atrás posterior. `tests/app/areas-order.test.tsx` usa un servidor falso que responde cuando la prueba lo pide, aplica el cambio y vuelve a dibujar la página (como la revalidación), y responde todo al final de cada prueba.
- **Movimiento reducido:** `useSortable({ transition: null })` (las filas saltan a su lugar; al soltar, dnd-kit puede poner `transform 0ms`), `scrollBehavior: "auto"` en el sensor de teclado y el aviso sin desplazamiento.
- **E2E** (`e2e/areas-order.spec.ts`, helpers en `e2e/support/areas.ts`):
  - La base E2E es compartida y reordenar rechaza listas viejas, así que las pruebas que crean, archivan, desarchivan o reordenan usan `testWithAreasLock`: un *advisory lock* de Postgres (`e2e_life_areas`) en su propia conexión durante toda la prueba (la espera no cuenta en el tiempo de la prueba). Las de solo lectura usan `test`.
  - Solo mueven, archivan o restauran áreas creadas por ellas: las 8 sembradas y su orden (que salen en las capturas) no cambian.
  - Antes de recargar para comprobar que algo se guardó, `untilSaved` espera la respuesta de la Server Action: la UI cambia antes (optimista). `waitForLoadState("networkidle")` no sirve: se resuelve de inmediato si la página ya había llegado a ese estado.
  - Los arrastres esperan los anuncios de dnd-kit (`[id^="DndLiveRegion"]`) entre teclas: mide las filas justo después de tomar una y las teclas anteriores se pierden. Antes de arrastrar con el ratón, se espera a que Radix quite `pointer-events: none` del `body` tras cerrar la hoja.
  - Capturas: cambian las 4 de la lista (asa y teclas en cada fila); se toman después de `sortableReady` (con dnd-kit cargado). No hay capturas nuevas: el aviso y las archivadas tienen nombres únicos por prueba; se cubren con axe en ambos temas.
  - Toque (solo celular, `hasTouch`): por CDP, un deslizamiento sobre el asa hace scroll y una presión con arrastre mueve la fila.

## Cómo funcionan las páginas de error (C8)

- **Vista común** (`src/modules/core/components/`): `StatusScreen` (LCD con la etiqueta y el estado, `<h1>` con `tabIndex={-1}`, una línea sin culpa y las salidas; sin hooks ni movimiento), `NotFoundScreen` y `ErrorScreen` (cliente). Textos en `STATUS_COPY` (`src/modules/core/copy.ts`).
- **404:**
  - `app/not-found.tsx` atiende toda URL que no existe. Se dibuja en el layout raíz, así que mira la sesión él mismo (`getOwnerSession()`, sin redirigir): **con sesión, dentro del shell** (`AppShell`, extraído del layout de `(app)`: navegación, `<main id="content">`, `SessionRefresher`, que se movió a `modules/core/components`) y con "Volver a Hoy"; **sin sesión, una página sola con "Ir a iniciar sesión"**. Sin cookie de sesión (`getSessionCookie` de `better-auth/cookies`, con o sin `__Secure-`) ni siquiera consulta la base. Si buscar la sesión falla (base caída), relanza las señales de Next (`unstable_rethrow`), registra una línea JSON (`not_found_session_failed`, solo nombre y `code`/`constraint` con `describeError`, nunca el mensaje) y sale la versión sin sesión.
  - Por qué no un *catch-all* en `(app)`: daría el shell, pero sin sesión redirigiría a `/login` (307) y el smoke test no podría distinguir una ruta inexistente de una protegida. Así, una ruta que no existe responde 404 siempre; revela qué rutas existen, lo que no es secreto en esta app.
  - `(app)/not-found.tsx`: para `notFound()` desde una página con sesión (p. ej. un elemento que no existe en módulos futuros); ya está dentro del shell.
  - Título "Página no encontrada · brahua-os" y `noindex` por `metadata`.
- **Errores:**
  - `(app)/error.tsx`: errores de las páginas con sesión, dentro del shell (la navegación sigue sirviendo).
  - `app/error.tsx`: lo que queda fuera del shell: el propio layout de `(app)` (p. ej. `requireOwner()` con la base caída; el `error.tsx` de un segmento no envuelve su layout), `/login` y el 404 raíz. Usa el layout raíz (tema y fuentes).
  - `global-error.tsx`: solo un error del layout raíz. Documento propio (`<html lang="es" data-theme="dark">`, `globals.css`, fuentes) sin `ThemeProvider`: se dibuja oscuro y, ya en el navegador, aplica el tema guardado (`storedTheme()`, `src/lib/stored-theme.ts`, misma clave que next-themes); si llegó renderizado del servidor con el tema claro guardado, puede verse oscuro un instante (aceptable para una página que casi nunca aparece).
  - "Reintentar" llama a `retry()` (Next 16.3: estable; vuelve a pedir y dibujar el segmento, sin recargar). "Volver a Hoy" es un `<a href="/">` (carga completa a propósito: el estado que falló empieza de cero).
  - **Sin detalles técnicos:** nunca se muestra `error.message` (en producción Next ya lo reemplaza en errores de servidor, pero un error de un componente cliente conserva el original). Solo el `digest` como "Código del error: …" en letra chica: es un hash opaco que coincide con el registro del servidor (Vercel), útil para el owner, que también mantiene la app; no dice nada del error. Sin `digest` (error de cliente) no se muestra código.
  - Accesibilidad: al aparecer, el foco pasa al `<h1>`. `ErrorScreen` dibuja `<title>Algo no salió bien · brahua-os</title>` con React (que lo sube al `<head>` y lo quita con la pantalla): tras un "Reintentar" que funciona vuelve el título de la página (E2E). También vale para `global-error` (no admite `metadata`). La LCD va con `live={false}` (la página entera es el aviso). Sin animaciones propias.
- **Rutas de prueba (solo E2E):** `/e2e/error` (en `(app)`, lanza mientras exista la cookie `bo_e2e_error=1`; sin ella dice "Todo en orden", lo que trae "Reintentar") y `/e2e/root-error` (fuera del shell, lanza siempre). Dos candados (`src/lib/e2e-error-routes.ts`):
  1. **Build:** los archivos son `page.e2e.tsx` y `next.config.ts` solo agrega la extensión `e2e.tsx` con `E2E_ERROR_ROUTES=1` (lo pone `playwright.config.ts` en el build y el servidor de la E2E). Cualquier otro build, producción incluida, no tiene esas rutas. Con la variable puesta en Vercel, `scripts/vercel-build.sh` se niega en su primera línea (antes de migrar) y `next.config.ts` también corta el build (`VERCEL=1`).
  2. **Ejecución:** aun en un build que las tenga, responden `notFound()` sin la variable.
  - CI (job `checks`, después de `pnpm build`) y `scripts/vercel-build.sh` corren `node scripts/check-no-e2e-routes.mjs`, que falla si el build tiene rutas `/e2e/*` (`.next/app-path-routes-manifest.json`) o si se construyó con la extensión `e2e.tsx` (`config.pageExtensions` en `.next/required-server-files.json`). Una prueba unitaria exige que todo `page.e2e.tsx` esté bajo una carpeta `e2e/` (si no, la primera comprobación no lo vería).
  - El smoke test (`scripts/smoke-production.sh`) ahora también pide `/no-existe`, `/e2e/error` y `/e2e/root-error` y espera 404 con `<h1>Nada por aquí</h1>` y las cabeceras de seguridad. Si se publicaran por error, `/e2e/error` daría 307 (layout de `(app)`) y `/e2e/root-error` 500. Con las de C7, la ronda tiene 10 peticiones (peor caso ≈ 9 min; el job tiene 15).
- **E2E** (`e2e/error-pages.spec.ts`): 404 con sesión (404, título, shell, "Volver a Hoy") y sin sesión (sin shell, "Ir a iniciar sesión", axe en ambos temas); error en el shell (foco en el `<h1>`, código, ni el mensaje ni rastros de stack en la respuesta HTTP, el DOM ni la consola; "Reintentar" con la causa activa vuelve a fallar y sin ella recupera la página en el mismo documento); error raíz (500, sin shell, sin detalles, axe en ambos temas). **8 capturas nuevas** (404 y error, por tema y viewport, de `<main>` sin la barra inferior; el código del error va enmascarado): el total pasa de 30 a 38.
- **Unitarias:** `tests/app/error-pages.test.tsx` (las cuatro páginas y `global-error` con `renderToStaticMarkup`), `tests/lib/e2e-error-routes.test.ts`, `tests/lib/stored-theme.test.ts`, `tests/scripts/check-no-e2e-routes.test.ts` (con un `.next` falso); `tests/app/protected-pages.test.ts` también exige `requireOwner()` en los `page.e2e.tsx` de `(app)`.
- **Pendiente fuera de C8:** la estructura de `SPEC-core.md` lista `error.tsx` y `not-found.tsx` solo en `(app)`; ahora también hay `app/error.tsx` y `app/not-found.tsx`. Las secciones "Pruebas E2E" (cantidad de capturas) y "Smoke test en producción" de este archivo no se tocaron en este PR (para no chocar con C7): lo nuevo está aquí.

## Pruebas E2E

- **Mientras se itera (sin Docker):** E2E nativa en macOS, solo con las specs que tocaste. `docker compose up -d` (solo la base) y luego `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/brahua_os_test pnpm test:e2e e2e/<spec>.ts`. `pnpm test:e2e:changed` corre las specs que cambiaron contra `origin/main` (`--only-changed` de Playwright: detecta specs y lo que importan, **no** el código de la app; si cambiaste solo `src/`, elige la spec a mano).
- **Capturas:** solo se comparan donde se generaron las referencias: Linux dentro de la imagen de Playwright (`mcr.microsoft.com/playwright:v1.63.0-noble`, la misma en CI, `update-screenshots.yml` y `pnpm test:e2e:docker`; se reconoce por `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). En cualquier otro lado se saltan y la prueba lleva la anotación `screenshot-skipped` en el reporte; el comportamiento y axe sí corren. Todo pasa por `expectScreenshot()` (`e2e/support/screenshots.ts`); ESLint prohíbe `toHaveScreenshot` directo en las specs y `ignoreSnapshots` en `playwright.config.ts` es la red de seguridad. `E2E_SCREENSHOTS=1` o `0` fuerza encenderlas o apagarlas en local.
  - **En CI nunca se apagan:** con `GITHUB_ACTIONS=true` se ignora `E2E_SCREENSHOTS=0`, `playwright.config.ts` lanza un error si no se compararían, y el job E2E comprueba `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` antes de correr.
  - **Huérfanas:** en la imagen, `expectScreenshot()` anota qué referencia usó (`test-results/.screenshots-used/`). Después de la suite completa, `node scripts/check-screenshot-orphans.mjs` falla en CI si hay un PNG que ninguna prueba comparó; `update-screenshots.yml` las borra (`--delete`). Solo vale tras la suite completa: no correrlo después de una spec suelta.
- **CI es el control completo** (todas las specs, con capturas, ~4 min). `pnpm test:e2e:docker` solo para reproducir CI en local (reinstala dependencias en el contenedor: lento).
- **Crear o actualizar referencias:** nunca con PNG hechos en macOS. Subir la rama y ejecutar `gh workflow run update-screenshots.yml --ref <rama>` (también desde Actions → Update screenshots → Run workflow).
  - Job `render`: corre `pnpm test:e2e --update-snapshots=changed` en el mismo entorno que el job E2E de CI (imagen, navegadores, fuentes y servicio Postgres) con un token de solo lectura, borra las huérfanas y sube `e2e/__screenshots__` completo como artefacto. Si falla otra prueba, no se commitea nada.
  - Job `commit` (`contents: write`, `actions: write`): el artefacto viene de un job que corrió código de terceros, así que solo acepta archivos regulares `<spec>.spec.ts/<nombre>.png` con la firma PNG; cualquier otra cosa hace fallar el job. Sobre el mismo commit que se renderizó, refleja ese conjunto (PNG nuevos, cambiados y huérfanas borradas), stagea solo `*.png`, commitea como `github-actions[bot]` con el mensaje `chore(e2e): update screenshots` y hace push a la rama. El checkout no guarda credenciales; el token llega solo al `git push` (como cabecera) y al `gh workflow run`. Si la rama avanzó mientras tanto, el push falla: volver a ejecutarlo.
  - Re-ejecución de CI: un push hecho con `GITHUB_TOKEN` no dispara workflows (salvo `workflow_dispatch` y `repository_dispatch`), así que el job llama `gh workflow run ci.yml --ref <rama>`; por eso `ci.yml` acepta `workflow_dispatch` (nunca despliega: el deploy exige `push` a `main`). Los checks quedan en el commit del bot y el PR los muestra.
  - `ci.yml` despachado en `main` falla (job `guard`), y su grupo de concurrencia incluye el evento (`ci-<evento>-<ref>`): un dispatch nunca cancela un run de push pendiente en `main`.
  - No corre en `main` ni en tags: ambos jobs tienen `if: github.ref_type == 'branch' && github.ref != 'refs/heads/main'` (el run queda omitido) y el job `commit` además falla si la rama es `main`.
  - `gh workflow run` solo encuentra el workflow si el archivo está en `main` (GitHub busca ahí los workflows de `workflow_dispatch`); el PR que lo creó lo probó con un trigger `push` temporal.
  - GitHub igual crea un run `pull_request` para el commit del bot, pero queda en "action required" (pide aprobación) y no corre: los checks que valen son los del run despachado.
- **Capturas que hay (30):** (C6 cambió las 4 de la lista) por tema (oscuro/claro) y viewport (celular/escritorio): login (4), navegación en la portada (4; la portada no tiene captura propia porque el saludo y la fecha cambian con la hora), barra lateral contraída (2, solo escritorio), lista de áreas (4), hoja de área (4), ajustes (4). Design system, solo escritorio y ambos temas (8): `key` (todos los estados y tamaños de la tecla), `kbd-tooltip` (Kbd sobre tecla naranja y tooltip abierto, que ninguna pantalla capta), `controls` (todos los estados de los controles) y `progress` (medidores que aún no usa ninguna pantalla). El resto de `/design` (text-field, list-row, sheet, area-tag, iconos, navegación…) ya sale en las pantallas.

## Cómo funciona la PWA (C7)

- **Manifest** (`src/app/manifest.ts` → `/manifest.webmanifest`): `name` y `short_name` "brahua-os", descripción en español, `lang: "es"`, `id`, `start_url` y `scope` en `/`, `display: "standalone"`, `background_color` y `theme_color` `#0A0A0A` (`--gray-925`, el fondo del tema oscuro, que es el de por defecto: el splash y la barra coinciden con la primera pintura). Sin `orientation`: la app sirve en vertical y en horizontal (barra lateral desde 1024 px).
- **Sin service worker** (SPEC-core, ADR 004): instalar no lo necesita; llega con `reminders` (push).
- **Íconos** (diseño "Panel mono"): una tecla oscura (`--gray-850`, con el borde inferior y el brillo de `--shadow-key`) con una "b" minúscula en Archivo 800 al 125 % de ancho (la cara de la marca, `.bo-sidebar__brand`) y un cuadrado naranja `--signal-500` en la línea base, como el LED de una tecla.
  - `public/icons/icon-192.png` y `icon-512.png` (`purpose: any`): tecla con esquinas transparentes y un margen del 4 %.
  - `public/icons/icon-maskable-512.png` (`maskable`): a sangre, sin transparencia; el monograma ocupa ~60 % y queda dentro del círculo seguro del 80 %.
  - `src/app/icon.png` (favicon 32×32, con el cuadrado más grande para que se lea a 16 px) y `src/app/apple-icon.png` (180×180, opaco; iOS redondea las esquinas). Reemplazan el `favicon.ico` por defecto; `/favicon.ico` redirige (307, `next.config.ts`) a `/icon.png` para los navegadores y rastreadores que lo piden sin leer el `<link rel="icon">`.
  - Se generan con `pnpm icons:build` (`scripts/build-icons.tsx`: `ImageResponse` de `next/og`, que ya trae `next`; sin dependencias nuevas) y **se commitean**: el build no los genera. El script baja Archivo 800/125 % de Google Fonts en TrueType y solo con la "b" (necesita red; falla si Google no responde 200). La salida es determinista (mismos bytes en cada corrida) **mientras Google sirva la misma versión de Archivo**: si la actualiza, volver a correrlo puede cambiar un poco los PNG; revisarlos antes de commitear.
- **Colores fuera del CSS:** `src/design-system/brand-colors.ts` guarda el hex de cada token que usan el manifest, los metas y los íconos (ESLint prohíbe hex fuera del design system); `tests/design-system/brand-colors.test.ts` falla si dejan de coincidir con `colors.css`.
- **iOS** (`metadata.appleWebApp` en el layout raíz): `mobile-web-app-capable`, título "brahua-os" y barra de estado `black` (opaca, texto blanco). No `black-translucent`: con el tema claro dejaría la hora en blanco sobre fondo claro.
- **`theme-color`:** el HTML del servidor trae uno por esquema del sistema (`#0A0A0A` oscuro, `#F2F2F0` claro), pero la app es oscura por defecto aunque el sistema esté en claro, y Ajustes puede fijar cualquiera. `ThemeColorSync` (`src/modules/core/components/theme-color-sync.tsx`, en el layout raíz) pone el color del tema aplicado en ambos metas cuando next-themes lo resuelve, y lo vuelve a poner al cambiarlo y después de cada navegación del cliente (`usePathname`). **Hasta hidratar** los metas siguen al esquema del sistema: el script previo a la pintura de next-themes no tiene cómo tocarlos y duplicar su lógica en un script propio no valía la pena (en iOS instalado la barra de estado es `black` igual; solo afecta un instante a la barra del navegador).
- **Sin sesión:** el manifest, `/icons/*`, `/icon.png` y `/apple-icon.png` están fuera de `(app)` (no hay `proxy.ts`; la sesión la pide el layout de `(app)`), así que responden 200 sin login y con las cabeceras de seguridad.
- **Pruebas:** `e2e/pwa.spec.ts` (sin sesión): el manifest y sus campos, cada ícono (200, `image/png`, tamaño real leído del PNG con `e2e/support/png.ts`), los `<link>` y metas de `/login`, los `theme-color` del servidor (con JavaScript apagado), que siguen al tema de la app y la redirección de `/favicon.ico`; con sesión, elegir "Claro" en Ajustes cambia ambos metas y siguen así tras navegar a `/areas` sin recargar. `tests/app/manifest.test.ts`: el manifest y que cada ícono commiteado tiene su tamaño. `tests/e2e-support/png.test.ts`: `pngSize`. `tests/design-system/brand-colors.test.ts`: cada hex es igual a su token y cada token cumple su papel en el tema (`--color-bg` → `--gray-925` en oscuro y `--gray-75` en claro, `--color-key`, `--color-text`, `--color-signal` y `--shadow-key`). El smoke test revisa el manifest y un ícono en producción.
- **Instalarla en el iPhone (pendiente, la hace el owner):**
  1. Abrir https://os.brahua.com en **Safari** (en iOS 16.4+ también sirve otro navegador con "Añadir a pantalla de inicio" en su menú de compartir).
  2. Botón Compartir → "Añadir a pantalla de inicio" → confirmar el nombre "brahua-os" → "Añadir".
  3. Abrirla desde el ícono: debe verse sin la barra de Safari, con la barra de estado negra, y respetar el notch y el indicador de inicio.
  4. La app instalada guarda sus cookies **aparte** de Safari (según la versión de iOS, copia las de Safari al instalarla o empieza vacía): puede que haya que entrar una vez. Probar ahí la passkey (Face ID), que es la verificación pendiente de C2b.
  5. Si se cambia el ícono más adelante, iOS no lo actualiza solo: hay que borrar la app de la pantalla de inicio y volver a añadirla.
- **Android (si hay uno a mano):** Chrome → menú ⋮ → "Instalar app" (o el aviso de instalación). Usa el ícono *maskable* con la forma del launcher.

## Respaldos (C10)

### Acción del owner (una sola vez, en una terminal normal)

Los secretos nunca pasan por la sesión del agente: todo esto se hace en tu terminal, en la raíz del repo. Necesitas `psql` versión 10 o mayor (`psql --version`; ya lo tienes) y, para restaurar, Docker.

1. **Ten a mano la conexión directa del dueño de la base.** Es el valor de `DATABASE_URL_UNPOOLED`: Vercel → brahua-os → Storage → brahua-os-db, o el panel de Neon → Connect con "Connection pooling" **apagado**. El host **no** debe tener `-pooler`. Como las variables son *Sensitive*, `vercel env pull` no sirve.
2. **Genera la contraseña del rol nuevo** y guárdala en tu gestor de contraseñas. Solo trae letras, números, `-` y `_` (no hay que escaparla en la URL) y tiene ~280 bits de entropía (Neon exige al menos 60):

   ```bash
   openssl rand -base64 36 | tr '+/' '-_' | tr -d '='
   ```

3. **Crea el rol de solo lectura `backup_ro`** con el script del repo, el mismo que prueba el CI. Primero pega la conexión del paso 1 (no se muestra); después `psql` pide la contraseña del paso 2 (esa sí se ve mientras la pegas):

   ```bash
   printf 'Conexión del dueño: ' && read -rs OWNER_DB_URL && echo && psql "$OWNER_DB_URL" -X -f scripts/backup/readonly-role.sql; unset OWNER_DB_URL
   ```

   - Tiene que terminar en `COMMIT`. Si dice "Run this as the table owner", la URL no es la del dueño de las tablas (la que usan las migraciones). Si dice que `backup_ro` ya existe, el rol ya estaba creado: sigue al paso 4 (o bórralo con `DROP OWNED BY backup_ro; DROP ROLE backup_ro;` y repite).
   - Qué hace: `CREATE ROLE backup_ro LOGIN`, `GRANT CONNECT` sobre la base, `USAGE` y `SELECT` sobre todas las tablas y secuencias de `public` (la app) **y de `drizzle`** (el historial de migraciones, que `pg_dump` también copia: sin ese permiso el respaldo falla), y `ALTER DEFAULT PRIVILEGES` para que las tablas que creen las migraciones futuras también sean legibles. Nada de escritura ni DDL.
   - **No lo crees desde la pantalla Roles de Neon:** en Neon, un rol creado desde la consola, la CLI o la API entra en `neon_superuser` (puede escribir y crear bases y roles). Uno creado con SQL solo tiene lo que se le da.
   - Alternativa sin `psql`: el SQL Editor de Neon, conectado como el dueño de las tablas (normalmente `neondb_owner`). Copia las sentencias de `scripts/backup/readonly-role.sql` desde `BEGIN;` hasta `COMMIT;` y reemplaza `:'backup_ro_password'` por la contraseña entre comillas simples.
4. **Arma la URL del respaldo:** la del paso 1 cambiando usuario y contraseña, con el mismo host directo (sin `-pooler`):

   ```
   postgresql://backup_ro:<CONTRASEÑA>@ep-xxxx.<región>.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

   Pruébala: tiene que mostrar el número de áreas y luego fallar al intentar escribir, con `permission denied for schema public`:

   ```bash
   printf 'URL del respaldo: ' && read -rs BACKUP_URL && echo && psql "$BACKUP_URL" -X -Atc "select count(*) from core_life_areas" && psql "$BACKUP_URL" -X -c "create table backup_ro_check (x int)"; unset BACKUP_URL
   ```

5. **Guarda el secreto en GitHub** desde tu terminal, **no** desde el `!` de la sesión de Claude (así se guarda vacío). `gh` lo pide sin mostrarlo; nunca lo pongas en la línea de comandos:

   ```bash
   gh auth switch -u Brahua
   gh secret set BACKUP_DATABASE_URL -R Brahua/brahua-os
   ```

6. **Corre el respaldo una vez**, cuando el PR de C10 ya esté en `main` (GitHub solo encuentra el workflow ahí), y revisa el artefacto:

   ```bash
   gh workflow run backup.yml -R Brahua/brahua-os
   gh run list -R Brahua/brahua-os -w backup.yml -L 1        # anota el ID del run
   gh run watch -R Brahua/brahua-os <ID>
   gh run download -R Brahua/brahua-os -D /tmp/brahua-backup <ID>
   ls -l /tmp/brahua-backup/*/
   ```

   Debe haber un `brahua-os-<fecha>.dump` y su `.sha256`. En la página del run (Actions → Database backup), el paso "Verify the dump" lista las tablas con datos. Si el run falla en "Check the target", el mensaje dice qué falta.

### Cómo funciona

- **`pnpm db:export` (JSON, en cualquier momento):** `DATABASE_URL_UNPOOLED='…' ALLOW_PROD_DB=1 pnpm db:export` escribe `exports/brahua-os-<fecha UTC>.json` (en `.gitignore` y `.vercelignore`; archivo `0600` en una carpeta `0700`; nunca sobrescribe). Solo lee, en una transacción `repeatable read` de solo lectura. Mismas reglas que `auth:owner`: solo `DATABASE_URL_UNPOOLED`, URL validada, host remoto solo con `ALLOW_PROD_DB=1` (`VERCEL=1` no cuenta), y muestra el destino sin credenciales.
  - Contenido: `format`, `schemaVersion` (versión del formato del JSON, hoy 1), `exportedAt`, `note`, `excludedTables` y `tables.<tabla>` con `rowCount` y `rows` (nombres de columna de SQL). Hoy: `core_life_areas` completa, archivadas incluidas.
  - **Nunca exporta las tablas de autenticación** (`auth_users`, `auth_sessions`, `auth_accounts` con los hashes, `auth_passkeys`, `auth_rate_limits`, `auth_verifications`); el archivo lo dice en `note` y `excludedTables`.
  - **Registro extensible:** cada módulo declara sus tablas en `src/modules/<id>/export.ts` y se agregan a `EXPORTABLE_TABLES` (`src/lib/data-export.ts`). Las pruebas fallan si una tabla de la base no está ni exportada ni en `EXCLUDED_TABLES`: un módulo nuevo tiene que decidir.
  - Pruebas: `tests/lib/data-export.test.ts` (registro, nombre del archivo, destino) y `tests/integration/data-export.test.ts` (archivadas incluidas, nada de auth aunque haya datos, cada tabla decidida, transacción de solo lectura, archivo privado que no se sobrescribe).
- **`.github/workflows/backup.yml` (semanal):** domingos a las 08:00 UTC (03:00 en Lima), y a mano con `gh workflow run backup.yml`.
  - Lee `BACKUP_DATABASE_URL` (rol `backup_ro`). Si falta, falla con un `::error::` que apunta a esta sección; también si la URL no es `postgresql://` o tiene `-pooler`. Nunca la imprime.
  - Lee la versión del servidor (`show server_version_num`) y corre el `pg_dump` de la imagen oficial `postgres:<mayor>` (cliente de la misma versión mayor que Neon), con `--format=custom --no-owner --no-privileges`. La URL entra al contenedor por variable de entorno, no por la línea de comandos.
  - Verifica el dump con `pg_restore --list` (tiene que traer datos de `public.core_life_areas` y `drizzle.__drizzle_migrations`), calcula el `sha256` y sube ambos como artefacto privado `db-backup-production-<fecha>` por **90 días**, visible solo para quien tiene acceso al repo.
  - El dump es **completo**: incluye las tablas `auth_*` (hash de la contraseña, sesiones vigentes). Por eso es privado y caduca; quien lo baje podría restaurar sesiones válidas.
  - `permissions` mínimos (`contents: read`), acciones fijadas por SHA, `timeout-minutes: 20`, concurrencia por destino sin cancelar.
  - **Prueba sin producción:** `gh workflow run backup.yml --ref <rama> -f target=ci-service` levanta un Postgres de servicio, le aplica migraciones y seed, crea `backup_ro` con el mismo `scripts/backup/readonly-role.sql` y respalda como ese rol (artefacto de 1 día). Se niega en `main` y en tags; los runs programados siempre son producción. El PR de C10 lo probó con un trigger `push` temporal, ya quitado: el run [36826811578](https://github.com/Brahua/brahua-os/actions/runs/36826811578) generó el artefacto, que se bajó, pasó el `sha256` y se restauró completo en una base vacía; otro run sin el secreto falló con el `::error::` esperado.

### Restaurar (nunca directo sobre producción)

1. Bajar el respaldo: Actions → Database backup → el run → Artifacts, o `gh run download <ID> -R Brahua/brahua-os -D /tmp/brahua-restore`. Comprobarlo: `cd /tmp/brahua-restore/db-backup-*/ && shasum -a 256 -c *.sha256`.
2. **Restaurar primero en una rama de Neon:** panel de Neon → Branches → New branch (desde `main`). En esa rama, Databases → New database `restore_check` (vacía). Copiar la conexión **directa** de esa base en la rama (sin `-pooler`), con el rol dueño.
3. Restaurar con un `pg_restore` de la **misma versión mayor** que el dump (el de `brew` es más viejo, así que se usa la imagen oficial), desde la carpeta del dump:

   ```bash
   printf 'Conexión de restore_check: ' && read -rs RESTORE_URL && echo && export RESTORE_URL && \
     docker run --rm -e RESTORE_URL -v "$PWD:/b:ro" postgres:17 \
       sh -c 'pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_URL" /b/brahua-os-<fecha>.dump'; unset RESTORE_URL
   ```

   Cambiar `17` por la versión que muestra el paso "Detect the server's Postgres major version" del run.
4. Revisar los datos en la rama (SQL Editor de Neon).
5. **Volver atrás en producción** es decisión del owner, con un respaldo nuevo antes. Para un error reciente conviene más el *restore* de Neon (Branches → `main` → Restore, a un momento dentro de la ventana de historial del plan) que reescribir producción con el dump. La ventana de historial del plan actual **está por confirmar** (SPEC-core, "Operación"): verla en el panel de Neon, en la configuración del proyecto.
6. Borrar la rama de prueba al terminar.

## Smoke test en producción

- Job `smoke` de `ci.yml`, después de `deploy`, solo en `push` a `main`.
- Primero confirma que `os.brahua.com` apunta al deploy recién publicado: el paso de deploy guarda la URL que imprime `vercel deploy` y el smoke compara con `vercel inspect os.brahua.com --json` (lectura de la API de Vercel), hasta 12 intentos; en el último muestra el stderr de `vercel inspect`. Las credenciales de Vercel solo están en ese paso.
- Luego `scripts/smoke-production.sh` (solo GET, sin credenciales, nunca inicia sesión ni escribe): `/`, `/areas` y `/settings` → 307 a `/login` (relativo o del mismo host, nunca otro); `/login` → 200 con `<h1>Iniciar sesión</h1>`; en todas, las 4 cabeceras de seguridad y `Strict-Transport-Security`; `/api/auth/ok` → 200 `{"ok":true}`; `/manifest.webmanifest` → 200 `application/manifest+json` con `"display":"standalone"` (y las cabeceras) y `/icons/icon-192.png` → 200 `image/png` (C7). Cada petición tiene 8 s como máximo; reintenta la ronda 6 veces cada 10 s (peor caso ≈ 6,5 min; el job tiene 15). Si falla, el job falla y GitHub avisa al owner.
- `/api/auth/ok` quedó fuera del rate limit (`"/ok": false` en `auth.ts`): si no, cada smoke escribiría un contador en `auth_rate_limits`.
- Se puede correr a mano: `bash scripts/smoke-production.sh` (o `SMOKE_BASE_URL=…`).
- `deploy` y `smoke` comparten el grupo de concurrencia `deploy-production` con `queue: max`: el siguiente deploy espera a que el smoke del anterior termine, y ningún job pendiente se cancela (por defecto, uno nuevo cancela al pendiente: un deploy perdido). `actionlint` todavía no conoce `queue` (se ignora en `.github/actionlint.yaml`).

## CI: acciones fijadas y protección de `main`

- Todas las acciones de los workflows están fijadas a un SHA completo con su versión en un comentario (`# v7.0.1`). Dependabot (`.github/dependabot.yml`, `github-actions`, semanal) propone las actualizaciones.
- **`main` sin protección: decisión aceptada por el owner (2026-10-01).** El repo es privado en el plan gratuito, que no tiene protección de rama ni rulesets, y el owner decidió no pagar GitHub Pro. La regla "merge solo con CI verde" se cumple por proceso: antes de cada merge, el agente comprueba que los 3 checks (`Lint, types, unit tests, build`, `E2E (Playwright + axe)` e `Integration tests (Postgres)`) están en verde, y nunca hace push directo a `main`. El deploy además exige que el run de ese push pase todos los checks.

## Decisiones recientes a respetar

- Driver: `pg` + Drizzle + `attachDatabasePool` (ADR-002). Migraciones con `DATABASE_URL_UNPOOLED`.
- Base Neon con variables **solo en Production**. Las pruebas usan Postgres desechable (Docker en local, servicio en CI), nunca producción.
- **Deploy con build remoto en Vercel** (desde `chore/faster-e2e`): el job `deploy` de `ci.yml` sube el checkout con `vercel deploy --prod --logs --json` y Vercel ejecuta `scripts/vercel-build.sh` (`auth:check-env`, `db:migrate`, `db:seed`, `next build`) con `VERCEL=1` y `VERCEL_ENV=production`. Un build fallido hace fallar el job (la CLI sale con 1 y `readyState` no es `READY`); el log del build sale en el job, con el enlace al inspector de Vercel. `.vercelignore` excluye `.env*` (salvo `.env.example`), `.claude/`, `.agents/`, `.github/`, `docs/`, `tasks/` y resultados de pruebas. Las pruebas y la E2E sí se suben: `next build` revisa los tipos de todo lo que incluye `tsconfig.json`.
- **Las variables de Neon son *Sensitive* y está bien:** solo existen dentro del build y del runtime de Vercel. Por eso no hay que volver a `vercel pull` + `vercel build` en GitHub Actions (las recibiría como `[sensitive]`).
- Incidente 2026-10-01: rotar las credenciales de Neon a *Sensitive* rompió `vercel pull` (migración con "Invalid URL", sin deploy); producción se restauró con un deploy manual con build remoto de `main@954bdf6`.
- Secretos: `gh secret set` desde el `!` de la sesión los guarda vacíos; el usuario debe usar una terminal normal.
- Diseño de pantallas nuevas: los hago yo con el design system, tomando como referencia las pantallas del proyecto de Claude Design; el usuario revisa en los checkpoints.
- Auth: la sesión se verifica en el layout de `(app)` **y** en cada página y query con `requireOwner()` y en cada acción con `ownerAction()` (C5), nunca solo en un proxy. El inicio de sesión va por el handler HTTP (cliente de Better Auth), no por `auth.api` en una Server Action, para que aplique el rate limit.
- Workflows multiagente: no usarlos en `core`. Proponerlos con un costo estimado para las specs en lote o para módulos paralelos.
