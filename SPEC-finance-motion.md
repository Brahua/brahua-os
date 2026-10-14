# Spec: finance-motion (rediseño de Finanzas con movimiento y contrato de motion)

> Extensión del módulo `finance` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `finance`, `finance-email` (cerrado) y del sistema de diseño · Estado: **APROBADO v1.0** (2026-10-14; preguntas resueltas abajo)
> Insumos: [`docs/analisis-finanzas-motion.md`](docs/analisis-finanzas-motion.md) (análisis y decisiones del owner) y el diseño en Claude Design: proyecto `3787b11d-b9b0-4ea2-bd5d-26d0f072f863`, archivos `brahua-os Finanzas.dc.html` (lienzo) y `Finanzas.dc.html` (componente). Fuente de verdad visual: el diseño; este documento fija qué se construye y cómo se prueba.

## Objetivo

Que Finanzas responda «¿cómo voy?» de un vistazo y se sienta viva: un total con su comparativo, el ritmo del mes contra el anterior, el desglose por categoría con un acento sutil por categoría, y un movimiento expresivo pero con propósito (entrada en cascada, cifras que ruedan, barras y línea que se dibujan, cambio de mes direccional, «Pagado» con una celebración contenida). Al mismo tiempo, deja un **contrato de movimiento reutilizable** (`src/lib/motion`) para llevar el mismo lenguaje al resto de los módulos.

Decisiones del owner (2026-10-14):

- Comparativos con el mes anterior: **sí**, en neutro (sin rojo ni verde, sin culpa).
- Gráfico: **SVG a mano + Motion** (sin librería de gráficos).
- Color: **muy sutil**, un acento por categoría (punto, segmento de la barra apilada, línea de 2 px en la fila); nunca fondos ni barras completas.
- Movimiento: **expresivo**, siempre con versión de movimiento reducido.
- Alcance: **piloto en Finanzas con contrato reutilizable** desde el primer corte.

Fuera de este módulo: presupuestos por categoría, metas de ahorro, ingresos, cambiar de librería de iconos, tocar otros módulos (solo se les deja el contrato), CSV/exportes nuevos.

## Lo que el diseño propone (resumen verificado contra el archivo)

- **Un solo control de 4 secciones** agrupadas bajo `MES` (Resumen · Gastos) y `PAGOS` (Pendientes · Pagados), con un indicador que recorre las cuatro (240 ms) y el contenido cruza con 6 px.
- **Mes › Resumen:** cabecera, flechas y nombre del mes, **total** grande con línea de contexto (delta vs. mes anterior y «Día 14 de 31»), dos tarjetas (*Gastado* con sparkline de 6 meses, *Pendiente de pagar* con n.º de pagos y próxima fecha, que lleva a Pagos), **gráfico de ritmo** (acumulado por día, mes anterior punteado, «hoy» en `signal`, tooltip con cursor, toque y ← →), y **desglose**: barra apilada de 44 px (segmentos pulsables, 2 px de separación) + lista por categoría (punto de color, nombre, monto, %) y una tarjeta con «Por medio de pago» y «Recurrente / suelto».
- **Mes › Gastos:** lista agrupada por día con el total del día; filas de 56 px con punto de categoría; fila seleccionada con botón de eliminar y «Deshacer» (toast LCD); chip «Quitar filtro» al filtrar. Tocar una categoría en Resumen filtra y lleva a Gastos.
- **Pagos:** *Pendiente de pagar* grande y contexto; «Pagado» con celebración de 1000 ms (tecla se invierte, el check se dibuja, la fila pasa a Pagados, el contador de Pagados pulsa con un anillo `signal`, mensaje LCD).
- **Movimiento** (tokens del sistema): cascada 320 ms + 3 × `--stagger` (72 ms) por bloque, desplazamiento máx. 8 px; cifras 520 ms `--ease-out`; línea y barra 900 ms, segmento a segmento cada 60 ms; cambio de mes: sale 120 ms (←8 px), entra 240 ms; filtro 260 ms, chip con `--ease-pop`; hoja 380 ms `--ease-drawer`; eliminar colapsa 280 ms. Solo `opacity` y `transform`, salvo el trazo SVG (dash) y la altura al colapsar filas.
- **Color de categorías** `--cat-1…8`, oscuro y claro (valores en el diseño: oscuro `#D8BC84 #6FC0BB #82B8E8 #E39ABF #B79FEA #8E9BF0 #BDB2A5 #8C98A8`; claro `#8A6A1E #0F7470 #1F6CA8 #A8326F #6D45C2 #3A4FC4 #7A6C5C #566274`).
- **Componentes nuevos propuestos:** `MetricCard`, `StackedBar`, `AreaChart`, `FilterChip`.
- **Movimiento reducido:** cascada solo fundido; cifras, línea y barra aparecen en su valor final; mes y pestañas con fundido cruzado; sin recorrido ni rebote del chip; «Pagado» sin dibujar el check ni anillo.

## Diferencias entre el diseño y la app real (decisiones que esta spec toma)

El prototipo usa datos de ejemplo y su propio motor de animación; la app real tiene otras reglas. Lo siguiente **no se copia tal cual**:

1. **Categorías:** el diseño fija 8 (Vivienda, Alimentación…); en la app son **editables** (`finance_categories`: id, nombre, orden; hoy «Facturas y servicios», «Mascotas», «Familia»…) y pueden ser más o menos de 8. *Decisión propuesta:* nueva columna `color_slot smallint NULL` (migración **aditiva**) con valor 1…8; las existentes se rellenan por su orden actual, las nuevas toman el primer slot libre (con más de 8 se repiten, en orden). Sin color (`NULL`) → slot 8 «Otros». El acento nunca es el único portador de información: nombre y monto siempre presentes.
2. **Estructura de pestañas:** hoy Mes/Pagos son 2 vistas (cookie). El diseño las divide en 4 secciones. *Decisión propuesta:* adoptar las 4 secciones; la cookie `FINANCE_VIEW_COOKIE` pasa a recordar `mes:res|mes:gas|pagos:pen|pagos:pag` (valor antiguo `mes`/`pagos` sigue válido y mapea a `…:res`/`…:pen`); «Pagados» es el historial del mes ya existente en Pagos.
3. **USD:** el diseño solo tiene soles. La app mezcla PEN y USD convertido con el tipo de cambio y suma USD sin convertir aparte. Totales, barras, sparkline y gráfico usan **solo PEN convertido**; el USD sin convertir sigue mostrándose como hoy («+ USD … sin convertir») y **se excluye** del gráfico y del comparativo con una nota visible cuando exista.
4. **«Pagado»:** el diseño paga con un toque; la app abre `PaySheet` para confirmar el monto cobrado y el medio (y soporta omitir, «Deshacer» exacto, periodos). La celebración se engancha **después** de que la acción vuelve con éxito (con la id del periodo), nunca antes ni en lugar de la hoja. Sin cambio de reglas de F2/E5/E6.
5. **Eliminar gasto:** el diseño selecciona la fila y muestra un botón; la app ya tiene su flujo (`deleteRow` con `expense-delete:<id>` y «Deshacer» con el id exacto). Se **conserva el flujo actual**; solo se anima la salida (colapso) y el regreso.
6. **Motor de animación:** el prototipo usa un `requestAnimationFrame` propio. La app usa **Motion** (`motion@14`, ya instalado) y `NumberFlow` (cifras); el diseño es la referencia de duraciones, curvas y estados, no del código.
7. **Navegación lateral y barra inferior** del lienzo son del prototipo: no se tocan (la navegación real es la del módulo `core`).
8. **Datos que el diseño inventa:** el «delta», el sparkline, el gráfico del mes anterior y «próxima fecha» necesitan datos reales (ver «Datos»).

## Historias de usuario

1. Abro Finanzas y veo cuánto llevo, cuánto más/menos que el mes pasado a la misma altura y qué tengo por pagar, sin hacer cuentas.
2. Veo en qué categorías se va el gasto de un vistazo (barra apilada con acentos suaves) y toco una para ver solo sus gastos.
3. Cambio de mes y el contenido se desplaza en esa dirección y las cifras ruedan al nuevo valor.
4. Registro un gasto y veo entrar la fila; borro uno, se colapsa y puedo deshacer.
5. Marco un pago como «Pagado» y lo noto: el check se dibuja, la fila pasa a Pagados, el contador sube.
6. Con «reducir movimiento» activo, nada se desplaza ni rebota; los cambios siguen siendo claros.
7. Otro módulo puede reutilizar el mismo lenguaje de movimiento sin copiar código.

## Contrato de movimiento (`src/lib/motion`)

- **Tokens:** duraciones y curvas se leen de las variables CSS del sistema (`--duration-*`, `--ease-*`, `--stagger`, `--motion-travel`); un módulo TS las espeja como constantes con un **test que falla si divergen** del `tokens/motion.css` sincronizado. Nada de números mágicos en componentes.
- **`MotionProvider`:** envuelve la pantalla con `LazyMotion` (features cargadas con `import()` dinámico, `domMax` solo donde hay `layout`/arrastre, `domAnimation` en el resto) y `MotionConfig reducedMotion="user"`. Un único punto de decisión de «movimiento reducido» (`usePrefersReducedMotion` ya existe y se reutiliza).
- **Variantes compartidas:** `cascade` (entrada escalonada), `crossFade`/`slideSwap` (cambio direccional con `custom`), `collapse` (altura + opacidad para filas), `pop` (chip), `drawPath` (trazo SVG), `flash` (destello de acento). Cada una declara su versión reducida.
- **Reglas:** solo `transform`/`opacity` (más `pathLength` y altura al colapsar); toda animación que desmonta devuelve el foco explícitamente; ningún `setTimeout` que cambie estado sin limpieza al desmontar; `NumberFlow` con `respectMotionPreference`; la primera carga anima, las acciones no repiten la cascada.
- **Pruebas:** helper de test para mockear Motion en jsdom (patrón de `swipe-row`) y para forzar `reducedMotion`.

## Datos

Sin tablas nuevas salvo la columna `color_slot`. Lecturas nuevas (todas de solo lectura, en una consulta cada una, `ownerAction`/`requireOwner` en la página):

- `getMonthlyTotals(month, count = 6)`: total PEN convertido por mes (para sparkline y comparativo), con el mismo criterio de conversión que `summary.ts`.
- `getPreviousMonthCumulative(month)`: acumulado por día del mes anterior (para la línea punteada). El del mes en curso se deriva de las filas ya cargadas.
- «Próxima fecha»: `getPendingForMonth` ya entrega los pagos; se calcula el próximo vencimiento ahí, sin consulta nueva.

Reglas: «mismo punto del mes» compara el acumulado de hoy contra el acumulado del mes anterior **al mismo día** (si el anterior tuvo menos días, se acota); un mes sin antecesor (2000-01) o sin datos no muestra comparativo ni línea punteada; mes sin gastos: gráfico vacío con mensaje, no cero engañoso.

## Tech stack

Sin dependencias nuevas: Next 16, React 19, `motion@14`, `@number-flow/react`, Drizzle/Postgres. Gráfico y barra apilada son SVG/HTML propios. Antes de escribir código se lee la guía de Next en `node_modules/next/dist/docs/` (regla del repo) y la documentación de Motion vía Context7 (ya consultada: `LazyMotion`, `m`, `MotionConfig reducedMotion`, `AnimatePresence`, `useReducedMotion`).

## Comandos

Los del repo: `nvm use`; `prettier --check`, `eslint`, `pnpm typecheck` y las unitarias tocadas (`rtk proxy pnpm vitest run --maxWorkers=2 <archivos>`); migración con `pnpm db:generate` + Prettier sobre el snapshot; una integración por archivo (`rtk proxy pnpm test:integration <archivo>`). Build, suite completa, E2E, axe y capturas, solo en CI.

## Estructura del proyecto

- `src/lib/motion/` (nuevo): `tokens.ts`, `provider.tsx`, `variants.ts`, `use-reduced-motion` (reexporta el existente), `test-utils.ts`.
- `src/modules/finance/components/`: `metric-card.tsx`, `stacked-bar.tsx`, `area-chart.tsx`, `filter-chip.tsx` (nuevos; **registrados como componentes del sistema** en Claude Design con sus estados antes de moverlos al sistema local) y cambios en `finance-views.tsx`, `month-view.tsx`, `month-summary.tsx`, `payments-view.tsx`, `pay-sheet.tsx` (solo el gancho de celebración).
- `src/modules/finance/` : `trend.ts` (comparativo y acumulados, puros y testeados), `category-color.ts` (slot → variable CSS), consultas nuevas en `queries.ts`.
- Estilos en `extensions.css`/`overrides.css` (nunca `tokens/` ni `components.css`); `--cat-1…8` en `overrides.css` con nota `PENDING UPSTREAM` hasta aplicarlos en Claude Design.

## Estilo de código

Como el resto del módulo: comentarios en inglés explicando el porqué, copy en español en `*-copy.ts`, centavos enteros, `ownerAction`. Los componentes de gráfico reciben datos ya calculados (puros y testeables) y no calculan dinero.

## Estrategia de pruebas

- **Unitarias (grueso):** `trend.ts` (mismo punto del mes, mes más corto, sin antecesor, USD sin convertir excluido, mes vacío), `category-color` (relleno, repetición con más de 8, `NULL`), geometría del gráfico (escala, puntos, «hoy», índice por ← →), tokens espejados, variantes con y sin movimiento reducido.
- **Componente:** `StackedBar` (pulsable por teclado, `aria-pressed`, foco por segmento), `AreaChart` (`role="img"` con descripción hablada, tooltip por cursor/toque/teclado), `FilterChip` (foco devuelto a la fila al quitar), control de 4 secciones (flechas, `aria-selected`, cookie), celebración de «Pagado» (solo tras éxito; con reducido no hay anillo), `AnimatePresence` de filas con foco restaurado. Aserciones del estado final dentro de `waitFor`.
- **Integración (una por archivo):** `getMonthlyTotals` y el acumulado del mes anterior contra Postgres, con casos que **no** coinciden además del que sí (lección de subqueries de Drizzle) y control positivo; la migración de `color_slot`.
- **E2E:** **una** spec nueva (`e2e/finance-motion.spec.ts`, con su entrada en `SPEC_MODULES`) que recorre cambio de mes, filtro por categoría, registrar y «Pagado» con `reducedMotion: "reduce"` en Playwright (estado final determinista) y `afterSaveSettled`. Capturas: `update-screenshots.yml` justo después del push; las capturas existentes de Finanzas cambian.
- **Accesibilidad:** axe en la spec; contraste AA de textos mono ≥ 11 px y de los acentos; sin depender del color; descripción hablada de los gráficos.
- **En dispositivo:** el owner verifica en el iPhone fluidez, toque en el gráfico y barra de estado (Checkpoint).

## Límites

- **Siempre:** `reducedMotion` respetado y probado; solo `transform`/`opacity` en caminos calientes; foco restaurado tras todo lo que desmonta; limpieza de temporizadores; un solo E2E nuevo por corte; migraciones aditivas; el comparativo en neutro; el dato también como texto.
- **Preguntar primero:** dependencias nuevas, migraciones no aditivas, cambiar la regla de «Pagado»/omitir/deshacer, cambiar el cálculo del total o la conversión USD, tocar otros módulos más allá de dejarles el contrato.
- **Nunca:** rojo/verde de juicio en comparativos, confeti de pantalla completa, editar `tokens/` o `components.css`, mostrar montos reales en fixtures o capturas versionadas (el repo es público hasta ~2026-11-01), animar propiedades de layout costosas en listas largas, bloquear la interacción mientras se anima.

## Criterios de éxito

1. En Resumen se ven total, delta vs. mes anterior (neutro), «Pendiente de pagar» con próxima fecha, gráfico de ritmo con línea punteada del mes anterior, barra apilada y lista por categoría con acento; los números coinciden con `summarizeMonth` (prueba que compara ambos).
2. Cambiar de mes anima en la dirección de la flecha y las cifras ruedan; con flechas pulsadas rápido no se pierde ni se repite un mes (se conserva la regla de `pendingMonth`).
3. Filtrar por categoría (lista o barra) lleva a Gastos con chip «Quitar filtro»; quitarlo devuelve el foco a la categoría de origen.
4. Registrar, borrar y «Deshacer» siguen funcionando exactamente como hoy (mismas pruebas verdes) y suman su animación; ninguna animación bloquea la interacción.
5. «Pagado» celebra solo cuando la acción tuvo éxito; omitir, deshacer y corrección de monto (E6) no cambian.
6. Con `prefers-reduced-motion`, nada se desplaza ni rebota, el estado final aparece de inmediato y la información es la misma.
7. `src/lib/motion` tiene tokens que no pueden divergir del sistema, `MotionProvider`, variantes con su versión reducida y un test-util; un segundo módulo podría usarlas sin copiar código (basta con el contrato documentado y probado, decisión del owner; ningún otro módulo lo estrena en este trabajo).
8. Rendimiento: la carga de Motion es diferida; el JS añadido a `/finance` ≤ 25 kB gz (medido en CI con el build); 60 fps en el iPhone del owner (Checkpoint); sin cambio de layout acumulado visible (CLS ≈ 0).
9. Accesibilidad: axe sin violaciones nuevas; los gráficos tienen descripción hablada; todo es operable con teclado.
10. El owner recorre en producción (Chrome personal, datos `[QA]` borrados después) cada interacción del diseño y confirma que se siente como el diseño (Checkpoint final).

## Plan de cortes (para aprobar; después `tasks/plan.md` y `tasks/todo.md`)

| Corte | Contenido | Datos | E2E |
|-------|-----------|-------|-----|
| **M1. Contrato y movimiento base** | `src/lib/motion` (tokens, provider, variantes, test-utils); cascada de entrada, cifras (`NumberFlow` en categorías, medios, pendiente), barras que crecen, cambio de mes direccional, crossfade de secciones. Sin cambio de estructura. | no | 0 |
| **M2. Estructura nueva** | Control de 4 secciones (+ cookie), cabecera con delta y «Día n de m», tarjetas *Gastado*/*Pendiente*, barra apilada + lista, tarjeta única de medios y recurrente/suelto, total por día en Gastos. | `getMonthlyTotals` | 0 |
| **M3. Color de categorías** | Migración `color_slot`, `--cat-1…8`, punto/segmento/línea 2 px, asignación **automática** (sin selector en Ajustes, decisión del owner). | migración aditiva | 0 |
| **M4. Gráfico de ritmo** | `AreaChart` (línea que se dibuja, punteada del mes anterior, «hoy», tooltip por cursor/toque/teclado), sparkline. | `getPreviousMonthCumulative` | 0 |
| **M5. Acciones con vida + E2E** | Filtro con `FilterChip` y salida de filas, filas que entran/colapsan al registrar/borrar/deshacer, celebración de «Pagado», cierre con la spec E2E y capturas. | no | 1 |

Orden: M1 → M2 → M3 → M4 → M5 (M3 y M4 son independientes entre sí y pueden ir en paralelo con contratos fijados en M2). Cada corte en un PR, con su revisión (`code-reviewer`, `test-engineer`; accesibilidad en los de UI) y una sola subida.

## Preguntas resueltas (2026-10-14)

1. **Color por categoría:** asignación **automática** por orden (`color_slot`), sin selector en Ajustes.
2. **Estructura:** se adoptan las **4 secciones** del diseño (Resumen · Gastos · Pendientes · Pagados); reemplazan Mes/Pagos.
3. **Contrato en otro módulo:** basta con dejarlo **documentado y probado**; ningún otro módulo lo estrena aquí.
4. **Celebración de «Pagado»:** **como el diseño** (check que se dibuja, fila a Pagados, contador con anillo `signal`, mensaje LCD), contenida y apagada con movimiento reducido. Si en el iPhone se siente excesiva se recorta en el Checkpoint.
5. **Comparativo:** contra el mes anterior **al mismo punto del mes**.

## Preguntas abiertas

Ninguna. Decisiones autónomas a revisar con el owner: el valor `NULL` de `color_slot` cuenta como «Otros» (slot 8); con más de 8 categorías los colores se repiten en orden; el techo de ≤ 25 kB gz de JS añadido es una meta a medir en M5, no un bloqueo.
