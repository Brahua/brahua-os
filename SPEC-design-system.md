# Spec: design-system

> Módulo `design-system` del [mapa de capacidades](CAPABILITY-MAP.md) · Estado: **BORRADOR — pendiente de aprobación**
> Fuente visual: Claude Design, proyecto "Tres direcciones de diseño de hábitos", archivo `brahua-os Pantallas.dc.html` (dirección **3A · Panel mono**).

## Objetivo

Convertir la dirección visual **Panel mono** en un sistema reutilizable: tokens, componentes base y reglas. Así, cualquier pantalla futura se construye con las mismas piezas y se ve y se comporta igual, sin inventar estilos en cada módulo.

**Concepto:** la app se siente como un **instrumento de hardware**, al estilo Teenage Engineering y Nothing.
- Las acciones son **teclas físicas** que se hunden al presionarlas.
- Cada área de vida es un **LED** de color.
- Los mensajes de estado aparecen en una tira tipo **pantalla LCD**.
- Un solo color de señal, el **naranja**, marca "hoy" y "acción".

**Qué se consigue:**
1. Un solo lugar (`src/design-system/`) define cómo se ve y se mueve todo.
2. Los módulos (`core`, `projects`, `habits`…) solo **componen** piezas del design system; no escriben colores, sombras ni curvas sueltas.
3. Una guía viva en `/design` muestra cada componente en todos sus estados y en ambos temas.
4. El sistema se sincroniza con Claude Design para diseñar pantallas nuevas con los componentes reales.

**Fuera de alcance:** componentes con lógica de negocio. La fila de hábito, la tarjeta de proyecto y la barra de navegación se construyen **en su módulo**, con piezas del design system.

## Auditoría del diseño fuente → decisiones

| Hallazgo en el diseño | Decisión |
|---|---|
| 12 tonos de negro y gris casi iguales (`#111`, `#161616`, `#1A1A1A`, `#1F1F1F`, `#202020`, `#242424`, `#262626`, `#2A2A2A`…) | Escala `gray` de 9 pasos + tokens semánticos |
| Radios de 1, 2, 3, 5, 9, 10, 12, 14 y 16 px | 5 radios: `xs` 2, `sm` 6, `md` 10, `lg` 14, `xl` 28 + `full` |
| Separaciones de 2, 3, 5 y 7 px | Grilla de 4 px (con 2 y 6 px permitidos para ajustes finos) |
| Etiquetas mono de 9,5, 10 y 10,5 px (74 usos) | **Mínimo 11 px** |
| Texto claro sobre naranja: contraste 3,0:1 (falla AA) | Sobre naranja, **siempre texto negro** (5,9:1) |
| `#6E6E6A` sobre negro: 3,9:1; `#55544F`: 2,6:1 | Solo para elementos decorativos o deshabilitados, nunca para texto que haya que leer |
| Los 8 colores de área tienen par brillante y oscuro, ambos con AA (≥ 5,1:1) | Se mantienen tal cual: `led` (sobre oscuro) e `ink` (sobre tiza) |
| Sombra de "tecla" copiada a mano en muchos lugares | Tokens `shadow-key-*` + componente `Key` |
| El tema claro está en el selector pero no está diseñado | Propuesta de tokens claros con AA verificado; **se valida en Claude Design** antes de darla por buena |

## Tokens

Viven en `src/design-system/tokens.css` (Tailwind v4 `@theme`). Los valores base no cambian con el tema; los semánticos sí (`next-themes`, atributo `data-theme`).

### Color base

```css
@theme {
  --color-gray-1000: #000000; /* key bottom edge */
  --color-gray-950: #0A0A0A;  /* app background (dark) */
  --color-gray-900: #161616;  /* key / pad surface */
  --color-gray-850: #1F1F1F;  /* dividers, empty dots */
  --color-gray-800: #2A2A2A;  /* borders, key top highlight */
  --color-gray-600: #6E6E6A;  /* decorative / disabled only */
  --color-gray-400: #9A9A96;  /* secondary text (dark) */
  --color-gray-300: #BDBDB8;  /* pressed key edge (chalk) */
  --color-gray-100: #F2F2F0;  /* chalk: primary text (dark), background (light) */

  --color-signal-500: #FF4A1C; /* signal orange */
  --color-signal-700: #C2330A; /* pressed signal / signal text on light */
}
```

### Color semántico

| Token | Oscuro | Claro (propuesta) | Uso | Contraste |
|---|---|---|---|---|
| `--bg` | `#0A0A0A` | `#F2F2F0` | Fondo de la app | — |
| `--surface` | `#161616` | `#FFFFFF` | Teclas, paneles | — |
| `--surface-pressed` | `#F2F2F0` | `#0A0A0A` | Tecla activada (se invierte) | — |
| `--border-subtle` | `#1F1F1F` | `#E6E5E0` | Divisores | — |
| `--border` | `#2A2A2A` | `#D6D6D2` | Bordes, celdas vacías | — |
| `--text` | `#F2F2F0` | `#0A0A0A` | Texto principal | 17,7:1 / 17,7:1 |
| `--text-muted` | `#9A9A96` | `#55544F` | Texto secundario, etiquetas | 7,0:1 / 6,8:1 |
| `--text-disabled` | `#6E6E6A` | `#9A9A96` | Solo deshabilitado o decorativo | — |
| `--signal` | `#FF4A1C` | `#FF4A1C` | Relleno de acción y "hoy" | — |
| `--signal-text` | `#FF4A1C` | `#C2330A` | Texto naranja | 5,9:1 / 5,0:1 |
| `--on-signal` | `#0A0A0A` | `#0A0A0A` | Texto sobre naranja | 5,9:1 |
| `--signal-edge` | `#C2330A` | `#C2330A` | Borde inferior de la tecla naranja | — |

### Colores de área (LED)

Cada área tiene `led`, un tono brillante para fondo oscuro, e `ink`, un tono oscuro que se usa sobre tiza cuando la tecla está activada. Contraste de `led` sobre `#0A0A0A` e `ink` sobre `#F2F2F0`:

| Token | `led` | `ink` | Contraste | Área por defecto |
|---|---|---|---|---|
| `amber` | `#E8B04A` | `#875A00` | 10,1 / 5,4 | Hogar |
| `green` | `#5CCB8A` | `#1D7545` | 9,8 / 5,1 | Salud y Bienestar |
| `teal` | `#3CC3BC` | `#0A716C` | 9,2 / 5,2 | Finanzas e Inversiones |
| `blue` | `#74A7FF` | `#2C5DC0` | 8,2 / 5,5 | Aprendizaje |
| `violet` | `#AE9BFF` | `#6547CC` | 8,4 / 5,6 | Trabajo |
| `pink` | `#FF8DB0` | `#B3346A` | 9,1 / 5,2 | Relaciones y Familia |
| `orange` | `#FF9A5C` | `#AA4710` | 9,5 / 5,2 | Planes y Viajes |
| `lime` | `#C6DC5A` | `#5B6D0E` | 13,0 / 5,2 | Hobbies |

Se exponen como `--area-<name>-led` y `--area-<name>-ink`, y en Tailwind como `bg-area-blue-led`, `text-area-blue-ink`, etc.

### Tipografía

- **Archivo** (variable: ancho 62–125, peso 300–800) para títulos, contenido y botones. Los títulos usan `font-stretch: 125%`.
- **IBM Plex Mono** (400/500/600) para etiquetas, datos, contadores y la tira LCD. Siempre en mayúsculas con `letter-spacing` de 0.08–0.1em.
- Ambas se cargan con `next/font/google`, con `display: swap` y subset `latin`.

| Token | Fuente | Tamaño / interlineado | Peso | Uso |
|---|---|---|---|---|
| `display` | Archivo, ancho 125 % | 40 / 1.0 | 700 | Título de pantalla ("HOY") |
| `title` | Archivo, ancho 115 % | 26 / 1.1 | 700 | Título de sección o tarjeta |
| `title-sm` | Archivo | 22 / 1.2 | 600 | Cifra o título pequeño |
| `body-lg` | Archivo | 17 / 1.5 | 400 | Texto destacado |
| `body` | Archivo | 15 / 1.45 | 500 | Texto de interfaz (filas, botones) |
| `body-sm` | Archivo | 14 / 1.45 | 400 | Texto secundario |
| `label` | Plex Mono | 12 / 1.3, +0.08em | 500 | Etiquetas y metadatos |
| `label-xs` | Plex Mono | **11** / 1.3, +0.1em | 500 | Tamaño mínimo permitido |
| `data` | Plex Mono | 15 / 1.2 | 600 | Contadores ("3/6", "S/ 2 340") |

### Espaciado, radios y sombras

- **Espaciado:** la escala de Tailwind (múltiplos de 4 px), más `0.5` (2 px) y `1.5` (6 px) para ajustes finos.
  - Márgenes de pantalla: 16 px en el celular, 24 px desde 768 px.
  - Área táctil mínima: **44 × 44 px**.
- **Radios:** `xs` 2 px (LED, celdas, marcas), `sm` 6 px (chips), `md` 10 px (inputs, teclas pequeñas), `lg` 14 px (teclas, tarjetas), `xl` 28 px (bordes superiores de hojas) y `full`.
- **Sombras de tecla** (la "física" del sistema):

```css
@theme {
  --shadow-key: inset 0 -4px 0 var(--color-gray-1000), inset 0 1px 0 var(--color-gray-800), 0 0 0 1px var(--color-gray-850);
  --shadow-key-pressed: inset 0 -1px 0 var(--color-gray-300);
  --shadow-key-signal: inset 0 -4px 0 var(--color-signal-700);
  --shadow-key-signal-pressed: inset 0 -1px 0 var(--color-signal-700);
  --shadow-led: 0 0 8px currentColor; /* LED glow when the key is off */
}
```

- Al presionar una tecla: `translateY(3px)` y cambio de `shadow-key` a `shadow-key-pressed`.

### Movimiento

| Token | Valor | Uso |
|---|---|---|
| `--ease-press` | `cubic-bezier(.3, 0, 0, 1)` | Hundir y soltar teclas |
| `--ease-out` | `cubic-bezier(.16, 1, .3, 1)` | Entradas y apariciones |
| `--ease-sheet` | `cubic-bezier(.32, .72, 0, 1)` | Hojas y paneles |
| `--ease-pop` | `cubic-bezier(.34, 1.56, .64, 1)` | Confirmaciones con rebote leve |
| `--duration-press` | `90ms` | Tecla |
| `--duration-state` | `160ms` | Cambios de color o estado |
| `--duration-enter` | `400ms` | Aparición de contenido |
| `--duration-sheet` | `380ms` | Hoja inferior |
| `--duration-celebrate` | `600ms` | Día completo |

- Con `prefers-reduced-motion: reduce`:
  - Se anulan traslaciones, escalas y rebotes.
  - Solo quedan cambios de color y opacidad de 120 ms o menos.
  - La tecla cambia de estado sin hundirse.
- Solo se animan `transform`, `opacity`, colores y sombras.

## Componentes

Viven en `src/design-system/components/`. Cada uno:
- Tiene tipos TypeScript estrictos.
- Acepta `className` y reenvía `ref`.
- Usa elementos nativos (`button`, `input`, `a`).
- Se puede usar con teclado y tiene foco visible (anillo de 2 px en `--signal`, con separación de 2 px).
- Tiene su sección en `/design`.

Los que vienen de shadcn/ui (Radix) se reestilizan con los tokens; no se usan con su estilo por defecto.

| Componente | Descripción | Variantes y estados | Base |
|---|---|---|---|
| `Key` | Botón tecla física | `default`, `signal`, `ghost` · `sm`, `md`, `lg` · reposo, presionado, activado (`aria-pressed`), deshabilitado · `asChild` para enlaces | Propio |
| `IconKey` | Tecla cuadrada de solo ícono | Igual que `Key`; `aria-label` obligatorio | `Key` |
| `Led` | Punto de color de área | `off` (brillo y color `led`), `on` (color `ink`, sin brillo) · tamaños 6 / 8 / 10 | Propio |
| `AreaTag` | Código de 2 letras con LED ("SB", "FI") | `sm`, `md` · con o sin nombre | `Led` |
| `SectionLabel` | Etiqueta mono en mayúsculas, con contador opcional ("HÁBITOS · 2/6") | — | Propio |
| `StatNumber` | Cifra animada | Tamaños `data` y `title-sm` · formatos de moneda PEN/USD y porcentaje | `@number-flow/react` |
| `ProgressRing` | Anillo de progreso | Tamaños · color `signal` o de área · `role="progressbar"` | Propio (SVG) |
| `SegmentBar` | Barra dividida en N segmentos (meta semanal) | Llenos y vacíos | Propio |
| `DotMatrix` | Matriz de puntos: días × elementos | Estados de punto: vacío, lleno, hoy y pasado | Propio |
| `DayCell` | Celda de día de un hábito | `done`, `rest` (punteada), `today` (borde de señal), `pending` · solo la de hoy es interactiva | Propio |
| `Lcd` | Tira de mensaje de estado, estilo pantalla LCD | Neutro y señal · entra y sale sola | Propio |
| `Switch` | Interruptor | Encendido en naranja | Radix |
| `SegmentedControl` | Pestañas segmentadas (Activos, Pausados, Ideas; tema) | 2 a 4 opciones · el activo se ve como tecla activada | Radix Tabs / ToggleGroup |
| `TextField` / `TextArea` | Entrada de texto | Reposo, foco, error (mensaje debajo, `aria-describedby`), deshabilitado | Propio |
| `Sheet` | Hoja inferior | Arrastre para cerrar · se cierra con `Esc` y con el fondo | Vaul (Drawer de shadcn) |
| `Toast` | Aviso con acción "Deshacer" | Neutro y éxito · estilo `Lcd` | Sonner |
| `ListRow` | Fila tocable con divisor | Con acción al inicio y al final | Propio |

**Patrones de referencia.** No forman parte del design system; los implementa su módulo con estas piezas:

| Patrón | Módulo | Piezas |
|---|---|---|
| Fila de hábito | `habits` | `Key` + `Led` + `label` |
| Tarjeta de proyecto | `projects` | `AreaTag` + `SegmentBar` + `Key` |
| Barra de navegación con tecla de captura | `core` | `IconKey` + `Key signal` |
| Hoja de captura rápida | `today` | `Sheet` + `SegmentedControl` + `TextField` + `AreaTag` |

## Estructura

```
src/design-system/
  tokens.css               → @theme tokens + light/dark semantic variables
  fonts.ts                 → next/font setup (Archivo, IBM Plex Mono)
  components/
    key.tsx  led.tsx  area-tag.tsx  section-label.tsx  stat-number.tsx
    progress-ring.tsx  segment-bar.tsx  dot-matrix.tsx  day-cell.tsx
    lcd.tsx  switch.tsx  segmented-control.tsx  text-field.tsx
    sheet.tsx  toast.tsx  list-row.tsx
  index.ts                 → public exports (modules import only from here)
  area-colors.ts           → AREA_COLORS = ["amber", …] as const + helpers
src/app/(app)/design/page.tsx  → living style guide (owner-only)
design-sync/               → generated previews for Claude Design (@dsCard)
tests/design-system/       → unit + component tests
e2e/design-system.spec.ts  → visual snapshots + axe
```

- Los módulos importan **solo** desde `@/design-system`.
- Dentro de los módulos está prohibido escribir colores hex, sombras o curvas de animación sueltas. Hay una regla de ESLint que prohíbe literales `#hex` y `cubic-bezier` fuera de `src/design-system/`.

## Ejemplo de estilo

```tsx
// src/design-system/components/key.tsx
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

const keyVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium " +
    "transition-[transform,box-shadow,background-color] duration-press ease-press " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal " +
    "active:translate-y-[3px] motion-reduce:active:translate-y-0 disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-surface text-text shadow-key active:shadow-key-pressed aria-pressed:bg-surface-pressed aria-pressed:text-bg aria-pressed:translate-y-[3px] aria-pressed:shadow-key-pressed",
        signal: "bg-signal text-on-signal shadow-key-signal active:shadow-key-signal-pressed",
        ghost: "bg-transparent text-text-muted hover:text-text",
      },
      size: { sm: "h-11 px-3 text-body-sm", md: "h-12 px-4 text-body", lg: "h-14 px-5 text-body" },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

type KeyProps = React.ComponentProps<"button"> &
  VariantProps<typeof keyVariants> & { asChild?: boolean };

export function Key({ variant, size, asChild, className, ...props }: KeyProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(keyVariants({ variant, size }), className)} {...props} />;
}
```

## Andamiaje incluido

Este módulo es el primero del mapa, así que crea la base técnica de la app. El login, la base de datos y la navegación quedan para `core`:

- Next.js 16 + TypeScript `strict` + pnpm + ESLint + Prettier.
- Tailwind CSS v4 + inicialización de shadcn/ui (`components.json` apuntando a `src/design-system`).
- `next-themes` (Oscuro, Claro o Sistema; oscuro por defecto).
- Vitest + Testing Library, y Playwright + `@axe-core/playwright`.
- CI en GitHub Actions: `lint`, `typecheck`, `test`, `test:e2e` y `build`.

**Dependencias nuevas que este módulo introduce:**
- `class-variance-authority`, `clsx`, `tailwind-merge`
- `@radix-ui/react-slot`, `@radix-ui/react-switch`, `@radix-ui/react-toggle-group`
- `vaul`, `sonner`, `motion`, `@number-flow/react`, `next-themes`
- De desarrollo: `@testing-library/react`, `@axe-core/playwright`

## Comandos

```bash
pnpm dev                          # /design shows the living style guide
pnpm lint                         # includes the no-raw-colors rule
pnpm typecheck
pnpm test                         # unit + component tests
pnpm test:e2e                     # visual snapshots + axe on /design
pnpm test:e2e --update-snapshots  # accept intentional visual changes
pnpm design:export                # generate design-sync/ previews for Claude Design
```

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias (Vitest) | **Contraste automático:** se leen los pares texto/fondo de `tokens.css` y se exige ≥ 4.5:1 (≥ 3:1 en texto grande o elementos de interfaz), en ambos temas. También `AREA_COLORS` y los helpers. |
| Componentes (Testing Library) | Rol y nombre accesibles, teclado (`Enter`/`Space` en `Key`, flechas en `SegmentedControl`), `aria-pressed`, `Sheet` se cierra con `Esc` y devuelve el foco, `Toast` ejecuta "Deshacer" |
| E2E (Playwright) | `/design` en 390 px y 1280 px, en tema oscuro y claro: capturas de referencia por sección, **0 violaciones de axe**, y con `reducedMotion: "reduce"` ninguna transformación durante el presionado |

## Sincronización con Claude Design

**El código es la fuente de verdad.** Claude Design recibe una copia para diseñar pantallas nuevas con las piezas reales.

1. `pnpm design:export` genera en `design-sync/` una vista previa HTML por componente, con su comentario `@dsCard`, más `tokens.json`/`tokens.css`.
2. Tú inicias `/design-sync`, que crea un proyecto de tipo **Design System** en Claude Design, "brahua-os DS", y sube los archivos componente por componente.
3. Al diseñar una pantalla nueva en Claude Design, eliges "brahua-os DS" como design system. La pantalla sale con tus componentes, colores y tipografía.
4. Si cambias un componente en código, repites los pasos 1 y 2. Los cambios de diseño **no vuelven solos al código**: pasan por la spec del módulo y por una tarea.

## Límites

- **Siempre:**
  - Usar tokens; nunca valores sueltos en módulos.
  - Verificar el contraste con el test automático.
  - Probar cada componente con teclado y lector de pantalla (roles).
  - Respetar `prefers-reduced-motion`.
  - Actualizar las capturas solo cuando el cambio es intencional.
- **Preguntar primero:**
  - Agregar un token o un componente que no está en esta spec.
  - Cambiar el color de señal o las fuentes.
  - Agregar dependencias.
- **Nunca:**
  - Usar texto claro sobre naranja.
  - Usar etiquetas de menos de 11 px.
  - Poner lógica de negocio en el design system.
  - Usar componentes de shadcn con su estilo por defecto.
  - Desactivar reglas de lint o de axe para "pasar".

## Criterios de éxito

1. `/design` muestra los 17 componentes con todas sus variantes y estados, en tema oscuro y claro, a 390 px y 1280 px.
2. El test de contraste pasa para todos los pares semánticos y de área en ambos temas.
3. axe reporta 0 violaciones en `/design`.
4. Todos los componentes interactivos funcionan solo con teclado y tienen foco visible.
5. Con `reducedMotion: "reduce"`, presionar una `Key` no produce `transform` (lo verifica un test).
6. `grep` de `#[0-9a-fA-F]{6}` y `cubic-bezier` fuera de `src/design-system/` da 0 resultados, y ESLint lo verifica.
7. `pnpm design:export` genera una vista previa por componente, y el proyecto "brahua-os DS" existe en Claude Design con todas las tarjetas.
8. **Fidelidad:** en la guía viva, la tecla, el LED, la matriz de puntos y la tira LCD se ven como en `brahua-os Pantallas.dc.html`. Lo reviso contigo en una comparación lado a lado.
9. CI verde: `lint`, `typecheck`, `test`, `test:e2e` y `build`.

## Cambios que esto propone a `SPEC-core.md`

Requieren tu aprobación:

1. **`LIFE_AREA_COLORS`** pasa a ser los 8 colores de área de este sistema: `amber`, `green`, `teal`, `blue`, `violet`, `pink`, `orange`, `lime`. Sale `slate` y `red`: el rojo se evita a propósito (principio de "sin culpa").
2. **Áreas: `emoji` → `code`.** El diseño identifica cada área con un **código de 2 letras** y un LED ("SB", "FI", "HB"), no con emoji. Propuesta:
   - Columna `code char(2) unique`: dos letras en mayúsculas, validadas con Zod.
   - Se quita `emoji`, porque va contra el principio de diseño "sin emoji en la interfaz".
3. `core` importa sus componentes de `@/design-system` y no instala shadcn por su cuenta.

## Preguntas abiertas

1. **Tema claro:** los tokens claros son una propuesta con contraste verificado, pero no están diseñados. ¿Hacemos una pasada en Claude Design de "Hoy" en claro antes de implementarlo? Si no, el claro queda como beta.
2. **Tipografía:** ¿mantenemos Archivo + IBM Plex Mono tal como vienen del diseño? Recomiendo que sí.
