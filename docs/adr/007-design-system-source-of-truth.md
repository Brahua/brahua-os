# ADR-007: Design system con fuente de verdad en Claude Design

- **Estado:** aceptado (2026-09-29)
- **Módulo:** `design-system` ([`SPEC-design-system.md`](../../SPEC-design-system.md)) · PRs [#5](https://github.com/Brahua/brahua-os/pull/5), [#7](https://github.com/Brahua/brahua-os/pull/7), [#15](https://github.com/Brahua/brahua-os/pull/15), [#23](https://github.com/Brahua/brahua-os/pull/23)

## Contexto

La dirección visual de brahua-os ("3A · Panel mono") se diseñó en Claude Design, donde también se diseñan las pantallas nuevas. Si el código y Claude Design evolucionan por separado, cada pantalla nueva se diseña con piezas que ya no existen o que se ven distinto en la app.

## Decisión

- **Claude Design es la fuente de verdad visual** (README, `tokens/` y `components/` del proyecto). Cuando la spec y el README de Claude Design difieren en valores (colores, radios, tipografía, movimiento), manda Claude Design.
- **Copia sin cambios:** `src/design-system/styles/tokens/*.css` y `components.css` se copian tal cual desde Claude Design; `pnpm design:check` (en CI) comprueba con un lock que no se editaron a mano. Los cambios se bajan con la skill `design-sync-pull`.
- **Componentes:** `src/design-system/components/` es la versión TypeScript de los `.jsx` de Claude Design, con la misma API y las mismas clases `bo-*`, más accesibilidad y pruebas.
- **Ajustes locales** solo en `overrides.css` (correcciones) y `extensions.css` (piezas que Claude Design no tiene), nunca en los archivos copiados. Cada corrección se replica en Claude Design; cuando vuelve en la siguiente sincronización, se borra de `overrides.css` (hoy está vacío).
- **Guardarraíles:** ESLint prohíbe colores hex y curvas de animación sueltas fuera del design system; los colores que se necesitan fuera del CSS (manifest, íconos) viven en `brand-colors.ts` con una prueba que los compara con los tokens.
- Las pantallas nuevas las diseña el agente con los componentes del design system, tomando como referencia las de Claude Design; el owner revisa en los checkpoints.

## Alternativas

- **El código como fuente de verdad, con Claude Design como copia:** cada cambio visual se haría primero en código y Claude Design quedaría atrasado para diseñar.
- **Tailwind + shadcn sin sistema propio:** más rápido al inicio, pero sin la identidad visual elegida ni un lugar único para los tokens.

## Consecuencias

- Un cambio visual de fondo empieza en Claude Design y baja con una sincronización, no con un parche local.
- Una corrección urgente (por ejemplo, de accesibilidad) puede ir en `overrides.css`, pero queda como deuda hasta replicarla en Claude Design.
- Las capturas de la E2E detectan cualquier cambio visual que traiga una sincronización.
