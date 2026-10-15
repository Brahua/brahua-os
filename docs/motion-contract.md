# Contrato de movimiento (`src/lib/motion`)

> Creado en `finance-motion` M1 (2026-10-14). Spec: [`SPEC-finance-motion.md`](../SPEC-finance-motion.md). Finanzas es el piloto; cualquier otro módulo puede adoptarlo sin copiar código.

Movimiento que **explica un cambio de estado**, nunca decoración. Solo `opacity` y `transform` (más `pathLength` de un trazo SVG, la altura de una fila que se pliega y el ancho de una barra de datos). Todo se apaga o se reduce con `prefers-reduced-motion`.

## Qué hay

| Pieza | Para qué |
|---|---|
| `tokens.ts` | `DURATION`, `EASE`, `STAGGER`, `TRAVEL` y `SCREEN` (tiempos de pantalla que el diseño fija y aún no tienen token CSS). Los tres primeros **espejan** `design-system/styles/tokens/motion.css`; `tests/lib/motion-tokens.test.ts` falla si divergen. |
| `MotionProvider` | Un solo punto de decisión por pantalla: `LazyMotion` + `MotionConfig reducedMotion="user"`. `features`: `sync` (por defecto, `domAnimation` en el bundle: la primera pintura anima sin esperar una descarga), `lazy` (`domAnimation` por `import()`), `max` (`domMax` por `import()`, para `layout` y arrastre). |
| `useMotionEnabled()` | `true` solo bajo un `MotionProvider`. Los componentes animados dibujan marcado plano sin él: pruebas, páginas de error y pantallas que no han adoptado el contrato no ven estado de animación. |
| `Cascade` | Bloque de la entrada escalonada (`index` = su turno; 72 ms por posición). Es **CSS puro** (`.bo-cascade` en `extensions.css`, con los tokens del sistema): se pinta desde el HTML del servidor, sin esperar a la hidratación ni a `MotionProvider`. Se anima **una vez por pestaña** (`useEntryPending`): al volver a una pantalla ya no se repite. Acepta `className` y `attrs` (`data-*`). |
| `useDirectionalSwap` | Contenido que sigue una flecha (mes a mes): sale 8 px hacia la flecha y se atenúa mientras carga el siguiente, y llega desde el otro lado. Usa WAAPI (`motion/mini`); no necesita provider. |
| `useCrossFade` | Paneles que se turnan con `hidden`: el que aparece se funde y sube 6 px. |
| `useValueTransition` | La transición de un valor que no es transform (ancho de una barra): mismo tiempo que el resto; con movimiento reducido salta al valor final. |
| `variants.ts` | `slideSwap`, `crossFade`, `collapse`, `pop`, `drawPath`, `flash` y `settle`: datos puros. Los que M1 no usa (`collapse`, `pop`, `drawPath`, `flash`) los estrenan M4 y M5. |

## Cómo adoptarlo en otro módulo

1. Envuelve la pantalla con `<MotionProvider>` (en Finanzas, dentro de `FinanceScreen`).
2. Cada bloque de la entrada es un `<Cascade index={n}>`; el orden de lectura manda. No hace falta provider para esto.
3. Cifras: `NumberFlow` con `respectMotionPreference` dentro de un contenedor `aria-hidden` y el valor hablado aparte (ver `MoneyFlow`).
4. Barras de datos: `m.span` con `animate={{ width }}` y `useValueTransition` (ver `GrowFill`).
5. Importa solo duraciones y curvas de `tokens.ts`; nunca números sueltos ni `cubic-bezier(...)` (una regla de ESLint lo prohíbe).

## Reglas

- **Movimiento reducido:** Motion conserva opacidad y color y omite transformaciones (`MotionConfig`); lo que no pasa por Motion (`animate()` de `motion/mini`, anchos, trazos) lee `usePrefersReducedMotion`.
- **Foco:** toda animación que desmonta algo devuelve el foco de forma explícita. Lo que se mueve nunca contiene al control enfocado (las flechas del mes quedan fuera del contenido que se desliza).
- **Temporizadores:** ningún `setTimeout` que cambie estado sin limpiarlo al desmontar; los hooks cancelan sus animaciones.
- **Nada oculto hasta hidratar:** una animación de entrada no puede dejar el HTML del servidor con `opacity: 0` que solo JavaScript revela (pasó con un `initial` de Motion: la pantalla quedaba vacía hasta hidratar). Lo que entra al pintar se hace en CSS; Motion se reserva para cambios posteriores a la hidratación.
- **Estabilidad del árbol:** un componente animado no cambia de tipo de elemento ni de clase durante su vida (`Cascade` decide al montar); si lo hiciera, remontaría a sus hijos o cortaría la animación.
- **Sin Web Animations** (motor viejo, jsdom): los hooks WAAPI no hacen nada y el contenido simplemente cambia.
- **Pruebas:** sin provider los componentes son planos. Para probar con provider basta `render(<MotionProvider>…</MotionProvider>)`; `resetEntryForTests()` reinicia «la entrada ya ocurrió» y las pruebas de hooks WAAPI simulan `motion/mini` (ver `tests/lib/motion-contract.test.tsx`).

## Pendiente upstream

Los tiempos de `SCREEN` (cascada 72 ms, cambio de mes 120/240 ms, dibujo 900 ms, ajuste 520 ms, pestañas 240 ms, fila 260/280 ms) y el desplazamiento de 8 px viven solo en `tokens.ts`. Pedir a Claude Design que los promueva a tokens y entonces añadirlos al test de espejo (`PENDING UPSTREAM`, línea en HANDOFF).
