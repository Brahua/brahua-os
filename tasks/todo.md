# Tareas: design-system

> Plan: [`tasks/plan.md`](plan.md) · Spec: [`SPEC-design-system.md`](../SPEC-design-system.md)
> Cada tarea termina con: `pnpm lint && pnpm typecheck && pnpm test` en verde + commit en inglés (`feat(design-system): …`).

## Fase 1 — Base

- [x] **T1: Andamiaje de la app**
  - **Qué:** Next.js 16 (App Router, `src/`), TypeScript `strict`, pnpm, ESLint (config de Next) + Prettier, Tailwind CSS v4 y una página inicial vacía que diga "brahua-os".
  - **Aceptación:** `pnpm dev` levanta; `pnpm build` y `pnpm typecheck` pasan; `.env*` está ignorado.
  - **Verificar:** `pnpm build && pnpm typecheck && pnpm lint`
  - **Archivos:** `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `src/app/{layout,page}.tsx`, `src/app/globals.css`
  - **Tamaño:** M

- [x] **T2: Herramientas de prueba y CI**
  - **Qué:** Vitest + Testing Library (jsdom), Playwright con proyectos de 390 px y 1280 px, `@axe-core/playwright`, y un workflow de GitHub Actions con `lint`, `typecheck`, `test`, `test:e2e` (en el contenedor de Playwright) y `build`.
  - **Aceptación:** un test unitario y uno E2E de ejemplo pasan; el workflow corre verde en un PR.
  - **Verificar:** `pnpm test && pnpm test:e2e`; checks verdes en GitHub
  - **Archivos:** `vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts`, `.github/workflows/ci.yml`, `package.json`
  - **Depende de:** T1 · **Tamaño:** M

- [x] **T3: Tokens, fuentes y temas**
  - **Qué:**
    - `tokens.css`: grises, señal, semánticos oscuro/claro, 8 áreas `led`/`ink`, radios, sombras de tecla, curvas y duraciones, y utilidades de tipografía.
    - `fonts.ts`: Archivo e IBM Plex Mono.
    - `next-themes`, oscuro por defecto.
    - `area-colors.ts`.
    - Test de contraste que lee los pares de `tokens.css`.
  - **Aceptación:**
    - El test de contraste pasa en ambos temas (≥ 4.5:1 en texto).
    - El fondo y el texto de la app usan los tokens.
    - No hay FOUC de tema.
  - **Verificar:** `pnpm test tokens`; revisión manual en `pnpm dev`
  - **Archivos:** `src/design-system/{tokens.css,fonts.ts,area-colors.ts}`, `src/app/{layout.tsx,globals.css}`, `tests/design-system/contrast.test.ts`
  - **Depende de:** T2 · **Tamaño:** M

### Checkpoint 1
- [ ] CI verde, app vacía con tokens aplicados, test de contraste pasando.

## Fase 2 — Rebanada vertical y fidelidad

- [x] **T4: Guía viva `/design` + `Icon` + `Key` / `IconKey`**
  - **Qué:**
    - Página `/design`: una sección por componente, conmutador de tema para previsualizar, y 404 en producción.
    - Helper `cn`.
    - `Icon` (Lucide).
    - `Key` e `IconKey` con variantes, tamaños y estados, incluido hover solo con puntero.
    - Tests de componente.
    - Captura de referencia y axe de la sección.
  - **Aceptación:**
    - `Key` funciona con `Enter` y `Space` y usa `aria-pressed`.
    - La tecla se hunde con `--ease-press`, y no se hunde con reduced motion.
    - 0 violaciones de axe.
    - Captura base aprobada.
  - **Verificar:** `pnpm test key && pnpm test:e2e design`
  - **Archivos:** `src/app/(dev)/design/page.tsx`, `src/lib/cn.ts`, `src/design-system/components/{icon,key}.tsx`, `src/design-system/index.ts`, `tests/design-system/key.test.tsx`, `e2e/design-system.spec.ts`
  - **Depende de:** T3 · **Tamaño:** M

- [x] **T5: `Led` + `AreaTag` + set de íconos de área**
  - **Qué:** `area-icons.ts` (unos 40 íconos Lucide curados, con los 8 por defecto), `Led` (on/off con brillo) y `AreaTag` (ícono + LED + nombre opcional).
  - **Aceptación:**
    - Los 8 colores × on/off se ven en `/design` en ambos temas.
    - `AREA_ICON_NAMES` está tipado.
    - Axe en 0.
  - **Verificar:** `pnpm test area && pnpm test:e2e design`
  - **Archivos:** `src/design-system/{area-icons.ts,components/led.tsx,components/area-tag.tsx}`, tests
  - **Depende de:** T4 · **Tamaño:** S

- [ ] **T6: `SectionLabel`, `StatNumber` y `ListRow`**
  - **Qué:** etiqueta mono con contador, cifra animada con NumberFlow (formatos PEN/USD y %) y fila tocable con divisor.
  - **Aceptación:**
    - `StatNumber` anima al cambiar y respeta reduced motion.
    - `ListRow` es un botón o enlace real.
    - Axe en 0.
  - **Verificar:** `pnpm test && pnpm test:e2e design`
  - **Archivos:** `src/design-system/components/{section-label,stat-number,list-row}.tsx`, tests
  - **Depende de:** T4 · **Tamaño:** M

### Checkpoint 2 — Fidelidad
- [ ] Comparación lado a lado contigo: `Key`, `Led`, `AreaTag` y tipografía en `/design` frente a `brahua-os Pantallas.dc.html`. Los ajustes se hacen antes de seguir.

## Fase 3 — Resto de componentes

Estas tareas se pueden hacer en paralelo; todas dependen de T4.

- [ ] **T7: `ProgressRing` + `SegmentBar`**
  - **Qué:** anillo SVG con `role="progressbar"` y barra de N segmentos.
  - **Aceptación:** valores 0, 50 y 100 % correctos; nombre accesible; animación con token.
  - **Tamaño:** S

- [ ] **T8: `DotMatrix` + `DayCell`**
  - **Qué:** matriz días × elementos y celda de día con estados `done`, `rest` (punteada), `today` y `pending`.
  - **Aceptación:**
    - Solo la celda de hoy es interactiva.
    - Cada celda tiene su `aria-label` ("jueves 24: hecho").
    - El estado `rest` no se ve como error.
  - **Tamaño:** M

- [ ] **T9: `Lcd` + `Toast`**
  - **Qué:** tira de estado tipo LCD y Sonner reestilizado como LCD, con acción "Deshacer".
  - **Aceptación:**
    - El toast se anuncia (`aria-live`).
    - "Deshacer" ejecuta el callback.
    - Se cierra solo a los 4 s.
  - **Tamaño:** S

- [ ] **T10: `Switch` + `SegmentedControl`**
  - **Qué:** Radix Switch (naranja cuando está encendido) y ToggleGroup/Tabs con el activo como tecla activada.
  - **Aceptación:** navegación con flechas; `aria-checked` y `aria-selected` correctos.
  - **Tamaño:** M

- [ ] **T11: `TextField` / `TextArea`**
  - **Qué:** estados de reposo, foco, error (mensaje con `aria-describedby`) y deshabilitado.
  - **Aceptación:** `label` asociado; el error se anuncia; tamaño táctil de al menos 44 px.
  - **Tamaño:** S

- [ ] **T12: `Sheet`**
  - **Qué:** `Sheet` responsive: hoja inferior en el celular (Vaul, o Radix Dialog + Motion si Vaul no se mantiene) y panel lateral o diálogo desde `lg` (Radix Dialog).
  - **Aceptación:**
    - Se cierra arrastrando, con `Esc` y tocando el fondo.
    - El foco queda atrapado dentro y vuelve al disparador al cerrar.
    - Usa `--ease-sheet`.
    - A 390 px sale desde abajo; a 1280 px, desde la derecha.
  - **Tamaño:** M

- [ ] **T15: `Kbd` + `Tooltip` + layout de escritorio en `/design`**
  - **Qué:** tecla de atajo grabada, Radix Tooltip con `Kbd`, tokens de layout (`--sidebar-width`, `--content-max`, `--panel-width`) y `/design` con navegación lateral desde `lg`.
  - **Aceptación:**
    - El tooltip aparece con hover o foco y no aparece en pantallas táctiles.
    - `/design` se ve bien a 390, 768 y 1280 px.
  - **Tamaño:** M

Cada tarea de T7 a T12 y T15 se verifica con `pnpm test && pnpm test:e2e design`: tests de componente, sección en `/design` con captura aprobada y axe en 0.

### Checkpoint 3
- [ ] Los 20 componentes están en `/design` en ambos temas y en 390, 768 y 1280 px, con CI verde.

## Fase 4 — Protecciones y sincronización

- [ ] **T13: Regla de lint y reduced motion**
  - **Qué:**
    - Regla ESLint que prohíbe `#hex` y `cubic-bezier` fuera de `src/design-system/`.
    - Test E2E global: con `reducedMotion: "reduce"`, ningún componente aplica `transform` al interactuar.
  - **Aceptación:** la regla falla en un archivo de prueba con un hex suelto; el test pasa.
  - **Verificar:** `pnpm lint && pnpm test:e2e`
  - **Archivos:** `eslint.config.mjs`, `e2e/reduced-motion.spec.ts`
  - **Depende de:** T5–T12, T15 · **Tamaño:** S

- [ ] **T14: Exportar a Claude Design**
  - **Qué:** `pnpm design:export` genera en `design-sync/` una vista previa HTML por componente, con su comentario `@dsCard` de grupo, más `tokens.json` y `tokens.css`.
  - **Aceptación:**
    - Hay una tarjeta por componente con el grupo correcto (Colors, Type, Components…).
    - Después tú ejecutas `/design-sync` y el proyecto "brahua-os DS" queda con todas las tarjetas.
  - **Verificar:** revisar `design-sync/` y el proyecto en Claude Design
  - **Archivos:** `scripts/design-export.ts`, `design-sync/**`, `package.json`
  - **Depende de:** T13 · **Tamaño:** M

### Checkpoint final
- [ ] Se cumplen los 9 criterios de éxito de `SPEC-design-system.md`.
- [ ] Revisión contigo antes de empezar `core`.
