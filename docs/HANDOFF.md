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
  - ✅ C2b (passkey): PRs #16 y #17 integrados y en producción.
  - ✅ Checkpoint 1 (2026-09-30): el owner entra con contraseña y con passkey (Touch ID en el computador, Face ID en el celular).
  - ✅ Confirmado por el owner (2026-09-30): el tema **oscuro por defecto** es el correcto, y revisó la navegación en su celular real: bien, incluidas las zonas seguras (notch e indicador de inicio).
  - ✅ C3 (navegación): PR #19 integrado.
  - ✅ C4 (ajustes): PR #20 integrado.
  - 🟡 C5 (áreas: ver y crear): PR `feat/core-c5-areas` abierto, **sin merge**. Pendiente: revisores (`code-reviewer`, `test-engineer`, `security-auditor` porque agrega las primeras Server Actions con datos, y accesibilidad).
  - Siguiente: C6 (áreas: reordenar y archivar).

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
- **Pendiente en Claude Design** (reglas en `src/design-system/styles/overrides.css`; aplicarlas allá y luego borrarlas de aquí):
  - `Tooltip` (WCAG 1.4.13): se puede pasar el puntero al tooltip sin que se cierre (`pointer-events` mientras se ve y un `::before` transparente que cubre los 8 px de separación). Oculto usa `visibility: hidden`, que pasa a `visible` con el mismo retraso de 300 ms: así no captura el puntero antes de verse (C4). Además, `tooltip.tsx` cierra el tooltip con Esc hasta que el puntero sale o el foco se va.
  - `Switch` con movimiento reducido (C4): la perilla salta en vez de deslizarse (`transition-duration: 0ms` para `transform`).
  - Teclas activadas en colores forzados (C5): `.bo-key.is-on`, `[aria-pressed="true"]` y `[aria-checked="true"]` llevan un `outline` `Highlight` bajo `forced-colors: active` (si no, una muestra o un ícono elegido se ve igual que los demás).
  - `Sheet` (C5, en `sheet.tsx`, no en CSS): props `onClosed` y `bodyClassName`.
  - `BottomNav` (WCAG 1.4.10): columnas `repeat(5, minmax(0, 1fr))` para que las etiquetas se trunquen a 320 px en vez de desbordar.
- **Visto de paso, sin arreglar:** a 320 px, `/design` tiene desborde horizontal por secciones que ya existían (SectionLabel `w-80`, Lcd y ProgressRing). No es de la navegación.
- **E2E** (`e2e/home.spec.ts`):
  - Espera `data-nav-shortcuts="ready"` en `<html>` antes de pulsar teclas (los atajos existen solo tras hidratar).
  - Las pruebas negativas registran, con un listener propio puesto después del de `AppNav`, si alguien llamó a `preventDefault()`, y después comprueban que una tecla válida sí actúa. Así pueden fallar de verdad.
  - Los tamaños (`--sidebar-width`, `--bottom-nav-height`…) se leen de las variables CSS.
  - Las capturas de `/design` ocultan la barra inferior fija (`e2e/support/hide-app-nav.css`).

## Cómo funcionan los ajustes (C4)

- `/settings` (`src/app/(app)/settings/`): `requireOwner()`, título "Ajustes · brahua-os" y cuatro secciones (`<section>` nombrada por su `SectionLabel` h2): Apariencia, Teclado, Passkeys y Sesión. Ajustes aparece en la navegación (pie de la barra lateral, atajo 8; en el celular, en la barra inferior).
- **Tema** (`theme-picker.tsx`): `SegmentedControl` en modo radio (flechas, Inicio y Fin) sobre `next-themes`, nombrado por el título visible "Apariencia" y descrito por la línea sobre "Sistema". **Oscuro por defecto** (`SPEC-design-system.md`, que prevalece en lo visual; `SPEC-core.md` se alineó en v2.3). La elección vive en `localStorage` (`theme`) y el script de next-themes la aplica antes de pintar, así que no hay parpadeo. El servidor no conoce el tema guardado: hasta montar, el grupo se dibuja invisible con un valor fijo (si no, la hidratación dejaría el `aria-checked` del servidor) y al montar se vuelve a crear (`key`) para que la opción elegida no se anime desde el valor provisional.
- **Atajos** (`shortcuts-switch.tsx`): `Switch` con un `<label>` visible (tocar el texto también lo cambia) y descripción. Escribe `bo_shortcuts` con `shortcutsCookie()` y llama a `router.refresh()`: el layout vuelve a leer la cookie en el servidor y `AppNav` quita (o vuelve a poner) el listener, los `Kbd` y los `aria-keyshortcuts` sin recargar la página.
- Passkeys y "Cerrar sesión": los mismos componentes de C2b, movidos a `settings/_components/`. "Cerrar sesión" usa `aria-disabled` (no `disabled`) mientras espera, para no perder el foco si falla. La portada solo tiene el saludo.
- E2E (`e2e/settings.spec.ts`): el tema persiste tras recargar en las tres opciones y un `MutationObserver` puesto antes de cargar comprueba que `<html>` nunca tuvo otro tema (sin parpadeo); "Sistema" con `emulateMedia({ colorScheme })`. Las capturas solo toman Apariencia, Teclado y Sesión, porque la lista de passkeys cambia con otras pruebas. Cerrar sesión se prueba en `login.spec.ts` y `passkey.spec.ts` con sesiones propias: hacerlo con la sesión compartida la cerraría para las demás pruebas.

## Cómo funcionan las áreas (C5)

- **Capas** (`src/modules/core/`):
  - `life-area-input.ts` (sin código de servidor): esquema Zod compartido por el cliente y el servidor, `normalizeAreaName` (NFC, espacios seguidos en uno, recortado), los mensajes (`LIFE_AREA_ERRORS`) y el tipo `LifeAreaSummary`. Nombre de 1 a 60 caracteres; se rechazan los caracteres de control y de formato (`\p{Cc}`, `\p{Cf}`: NUL, ancho cero, marcas bidireccionales) con un error en el campo, así que NUL nunca llega a Postgres. Campos ajenos (`slug`, `sortOrder`, `archivedAt`, `id` al crear) se descartan.
  - `life-area-limits.ts`: el largo máximo, compartido con el `CHECK` de la base.
  - `life-areas.ts` (`server-only`): acceso a datos; recibe `db` y confía en su input (`selectLifeAreas`, `insertLifeArea`, `updateLifeAreaById`). Devuelve `LifeAreaSummary`, nunca la fila completa.
  - `actions.ts` (`"use server"`): `createLifeArea(input: unknown)` y `updateLifeArea(input: unknown)` (con `id` en el mismo objeto), construidas con **`ownerAction(schema, handler, { name })`** (`src/lib/owner-action.ts`): sesión del owner primero (sin sesión, con cookie falsa o con otro email → error de autorización sin mirar el input), Zod, el handler, y cualquier excepción se registra en el servidor (JSON de una línea, sin el input) y vuelve como error genérico. Un `id` que no existe es un error, no un insert. Es el patrón para los próximos módulos (documentado en `SPEC-core.md`).
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

## Decisiones recientes a respetar

- Driver: `pg` + Drizzle + `attachDatabasePool` (ADR-002). Migraciones con `DATABASE_URL_UNPOOLED`.
- Base Neon con variables **solo en Production**. Las pruebas usan Postgres desechable (Docker en local, servicio en CI), nunca producción.
- Secretos: `gh secret set` desde el `!` de la sesión los guarda vacíos; el usuario debe usar una terminal normal.
- Diseño de pantallas nuevas: los hago yo con el design system, tomando como referencia las pantallas del proyecto de Claude Design; el usuario revisa en los checkpoints.
- Auth: la sesión se verifica en el layout de `(app)` **y** en cada página y query con `requireOwner()` y en cada acción con `ownerAction()` (C5), nunca solo en un proxy. El inicio de sesión va por el handler HTTP (cliente de Better Auth), no por `auth.api` en una Server Action, para que aplique el rate limit.
- Workflows multiagente: no usarlos en `core`. Proponerlos con un costo estimado para las specs en lote o para módulos paralelos.
