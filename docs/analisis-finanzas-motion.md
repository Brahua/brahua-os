# Análisis visual y de movimiento: Finanzas (`/finance`)

> Insumo para `/spec-driven-development`. Revisión del 2026-10-14 sobre producción (solo lectura, escritorio 1568 px,
> tema oscuro) más lectura del código. No se revisó el móvil en vivo (no se tocó el tamaño de la ventana del owner):
> queda como verificación del Checkpoint.

## 1. Estado actual

**Qué hay:** título + Ajustes; pestañas Mes/Pagos; navegación de mes; total en grande (`NumberFlow`); «Registrar gasto»;
franja «Pendiente de pagar»; dos columnas (Por categoría con barras · Por medio de pago + Recurrente y suelto); lista
«Gastos del mes» agrupada por día. Pagos: Pendientes + «Este mes» + historial.

**Base técnica que ya existe (y condiciona la spec):**

- `motion@14.0.0` ya es dependencia, con el patrón de `LazyMotion` + `m` + carga dinámica de features
  (`tasks/components/motion-features.ts`, `swipe-row.tsx`). No hay `MotionConfig` global.
- `@number-flow/react` ya anima el total (con `respectMotionPreference`).
- Tokens de movimiento del sistema de diseño (`tokens/motion.css`): `--duration-*`, `--ease-out/-standard/-pop`,
  `--stagger: 24ms`, `--motion-travel: 3px`, y ya se anulan con `prefers-reduced-motion`. Hook `usePrefersReducedMotion`.
- El resumen se calcula en el cliente (`summarizeMonth`) desde las filas del mes: **no hay datos de otros meses** en la
  pantalla. Cambiar de mes es una navegación de servidor (`router.push` + `useTransition`).
- Las barras son `<span>` con `width` en % y sin transición; los tokens de color son sobrios a propósito
  («sin comparaciones, sin culpa, sin rojo», spec F3).

## 2. Hallazgos visuales (priorizados)

### P1: afectan a la lectura

1. **La pantalla no responde a «¿cómo voy?»** El total del mes está solo: sin contexto contra el mes anterior ni el ritmo
   del mes. Sin ningún gráfico, 8 categorías y 6 medios son tablas de texto con una barra de 6 px.
2. **Jerarquía plana en la mitad superior.** El total (28 px) compite con «Registrar gasto» y con la franja de
   Pendiente; el dato más accionable (S/ 5,017.18 pendientes, 8 pagos, más que el gasto del mes) se ve como una fila más.
3. **Columna derecha casi vacía.** «Por medio de pago» y «Recurrente y suelto» terminan a mitad de altura mientras la
   izquierda sigue: ~35 % de la fila queda en blanco en escritorio.
4. **La lista de gastos es larga y uniforme.** Los encabezados de día (`HOY`, `LUNES 12…`) son pequeños y sin total diario;
   no hay lectura rápida de «qué día gasté más».

### P2: pulido

5. **Barras de categoría en un solo gris**: sin identidad por categoría; la barra se lee peor que el porcentaje. Tienen
   `min-width: 2px` y 6 px de alto, difíciles de pulsar como filtro (la fila entera sí es el botón).
6. **Pestañas Mes/Pagos y flechas de mes** sin transición de contenido: el cambio es un corte seco, y al cambiar de mes la
   página «parpadea» hasta que llega el servidor.
7. **Pagos:** «Pagado» sin retroalimentación visual del cambio de estado (la fila salta de «Pendientes» a «Este mes»).
8. **Micro-tipografía**: metadatos de fila en mono 9–10 px (`DÉBITO BCP · MASCOTAS`) con poco contraste en oscuro; revisar
   contra WCAG AA antes de decidir tamaño.

## 3. Propuesta de contenido y organización

Orden propuesto de «Mes» (escritorio ≥1024 px; en móvil una sola columna en este orden):

1. **Cabecera de mes** (igual) con el total y, debajo, una línea de contexto: «vs. septiembre: +12 %» en neutro (texto
   secundario, sin rojo/verde: se mantiene la regla de F3, es dato no juicio) y, si es el mes actual, «Día 14 de 31».
2. **Tira de dos tarjetas:** *Gastado* (total + mini tendencia) y *Pendiente de pagar* (monto + n.º de pagos + próxima
   fecha). La segunda sigue llevando a Pagos. «Registrar gasto» pasa a la barra de la cabecera, alineado con Ajustes.
3. **Gráfico de ritmo del mes** (área o barras diarias acumuladas, mes actual vs. anterior como línea tenue). Necesita
   datos: ver §5.
4. **Desglose:** Por categoría como **barra apilada segmentada + lista** (el filtro por categoría se conserva y la
   barra apilada también lo activa) en lugar de 8 barras grises; a la derecha, medios de pago y recurrente/suelto en una
   sola tarjeta para igualar altura.
5. **Lista de gastos** con total por día en el encabezado y, opcionalmente, agrupar por semana colapsable (decisión
   abierta).

Fuera de alcance de esta iteración (anotar, no hacer): presupuestos por categoría, metas de ahorro, exportes, etc.

## 4. Dónde animar (Motion), por valor

Regla del producto: movimiento que **explica un cambio de estado**, nunca decoración; solo `transform` y `opacity`
cuando sea posible; todo apagado o reducido con `prefers-reduced-motion`; nada que tape el control enfocado (reglas
de foco y «Toasts y overlays» de `CLAUDE.md`).

| # | Dónde | Qué | Herramienta | Notas |
|---|-------|-----|-------------|-------|
| M1 | **Entrada de la pantalla** | Aparición escalonada de bloques (cabecera → tarjetas → desglose → lista), 24 ms de `--stagger`, `--motion-travel` 3 px | `m` + variantes, o CSS puro | Solo en la primera carga de la sesión; no al volver de una acción. |
| M2 | **Barras de categoría y apilada** | Crecen de 0 a su ancho al entrar y **se interpolan** al cambiar de mes o de filtro (`scaleX` o `width` con `layout`) | `m.span` con `animate` | Hoy saltan. Es la mejora más visible por menos código. |
| M3 | **Total y cifras** | Ya hay `NumberFlow` en el total; extender a categorías, medios, pendiente y %. | `NumberFlow` (ya instalado) | Sin dependencia nueva. |
| M4 | **Cambio de mes** | Contenido sale/entra en la dirección de la flecha (±8 px + fade); esqueleto de las barras mientras llega el servidor | `AnimatePresence mode="popLayout"` + `custom` (dirección) | Hoy hay un `useTransition` (`navigating`): engancharlo ahí. Alternativa de coste cero: `<ViewTransition>` de React. |
| M5 | **Mes/Pagos** | Indicador deslizante bajo la pestaña activa y cruce de contenido | `layoutId` compartido | Respetar que la vista se recuerda en cookie (primer pintado correcto sin animación). |
| M6 | **Filtro por categoría** | Las filas que no coinciden salen con `exit`, el resto sube (`layout`); chip «Quitar filtro» entra con `pop` | `AnimatePresence` + `layout` en `<li>` | Cuidado con el foco al «Quitar filtro»: ya está resuelto en el código, no regresionar. |
| M7 | **Registrar / borrar gasto** | La fila nueva entra desde arriba con un destello breve de acento; al borrar, sale colapsando altura. «Deshacer» la hace volver. | `AnimatePresence` + `layout` | El gasto ya es optimista (`useOptimistic`): animar sobre esa transición, con la id exacta. |
| M8 | **Pagos: «Pagado»** | El check se dibuja (`pathLength`), la fila viaja de Pendientes a «Este mes» con `layoutId` | `m.path`, `layoutId` | La más «satisfactoria»; existe `celebrate.ts` para el patrón de celebración ya aprobado. |
| M9 | **Gráfico de ritmo** | La línea/área se dibuja de izquierda a derecha; tooltip al pasar con el cursor/dedo | SVG propio + `m.path` | Ver §5 sobre la librería. |
| M10 | **Sheets** (registrar, pagar) | Ya existen (`--duration-sheet`); solo revisar consistencia con las nuevas animaciones. | n/a | Sin trabajo nuevo salvo auditoría. |

Rendimiento: hoy Motion se carga solo en filas arrastrables (`domMax`, carga dinámica). Para Finanzas basta
`domAnimation` (~4.6 kB, según la documentación oficial de Motion vía Context7) más `layout` → **usa `domMax`** solo si hay
`layout`/drag; decidir en la spec si se envuelve `FinanceScreen` en un `LazyMotion` propio de la pantalla. Un
`MotionConfig reducedMotion="user"` a nivel de pantalla centraliza la accesibilidad (desactiva transformaciones y mantiene
opacidad/color).

## 5. Gráficos: opciones y decisión pendiente

Datos: hoy solo llega el mes en curso. Para tendencia y comparación hacen falta, **sin tabla nueva**:

- `getMonthlyTotals(monthsBack = 6)`: `SUM(amount)` por mes y categoría desde `finance_expenses` (una consulta, mismo
  criterio de conversión USD→PEN que `summary.ts`, y ojo con USD sin convertir).
- `getDailyCumulative(month)`: acumulado diario del mes y del anterior (se puede derivar en cliente de las filas ya
  cargadas para el mes actual; el anterior requiere una lectura más).

Librería del gráfico (decisión): (a) **SVG a mano + Motion** (recomendado: 2–3 formas simples, cero peso extra,
control total de reducción de movimiento y de accesibilidad, coherente con el sistema); (b) Recharts/visx: más rápido
para tooltips y ejes, pero ~40–90 kB y estilos ajenos al sistema de diseño. Con la nota del `dataviz` skill: paleta
neutra validada en claro/oscuro y todo dato también disponible como texto/tabla (ya lo está en la lista).

Accesibilidad de los gráficos: cada gráfico lleva `role="img"` con descripción hablada («Gasto acumulado: 3,682 soles,
por encima del mes anterior a esta altura») y su dato también existe en la lista; los segmentos no dependen solo del color.

## 6. Riesgos y reglas del repo que tocan esta iniciativa

- **Presupuesto E2E:** un corte añade como máximo **una** spec E2E; el resto unitarias/componente. Un cambio visual
  cuesta una ronda de capturas (`update-screenshots.yml`).
- **Capturas y animaciones:** las capturas esperan estado final: `afterSaveSettled(page)` y desactivar movimiento en
  Playwright (`reducedMotion: "reduce"`) o esperar a que terminen; si no, flakes.
- **Foco:** nada de `disabled` en el control enfocado; `AnimatePresence` desmonta: devolver el foco explícitamente
  (ver «Lessons from `core`»).
- **Temporizadores:** cada `setTimeout` que cambie estado se limpia al desmontar (lección de `tasks`).
- **Sistema de diseño:** no editar `tokens/` ni `components.css`; lo nuevo va en `overrides.css`/`extensions.css` con la
  marca `PENDING UPSTREAM` si es un componente sincronizado.
- **Tono:** nada rojo, nada de culpa; los comparativos son neutros.
- **iPhone es la verdad** de la PWA: las animaciones táctiles y el rendimiento se confirman en el dispositivo.
- **Pruebas en jsdom:** Motion en jsdom necesita mocks; seguir el patrón de `swipe-row` para sus pruebas.

## 7. Cortes sugeridos para la spec (de menor a mayor riesgo)

| Corte | Contenido | Datos nuevos | E2E |
|-------|-----------|--------------|-----|
| **A. Movimiento sobre lo existente** | M1, M2, M3, M5, M6 + `MotionConfig` de la pantalla | no | 0–1 |
| **B. Reorganización** | §3 puntos 1, 2, 4 (tarjetas, barra apilada, columna derecha unificada, total por día) | no | 0 |
| **C. Acciones con vida** | M4, M7, M8 | no | 1 |
| **D. Tendencia** | gráfico de ritmo + comparativa vs. mes anterior (M9) | sí (2 consultas) | 1 |

Orden recomendado: A → B → C → D. A y B son independientes del esquema y de la base de datos.

## 8. Decisiones del owner (2026-10-14)

1. Comparativos con el mes anterior: **sí**, en neutro.
2. Gráfico: **SVG a mano + Motion**.
3. Color: **sí, muy sutil**: un acento distintivo por categoría (punto, borde o segmento fino), nunca la fila ni la barra
   entera; sigue sin rojo ni juicio.
4. Intensidad de movimiento: **expresiva** (entrada escalonada, celebración en «Pagado»), siempre con reducción de movimiento.
5. Alcance: **piloto en Finanzas con contrato reutilizable** (`MotionConfig` y variantes en `src/lib/motion`) desde el corte A.

Flujo: los diseños se iteran en Claude Design (prompt en `docs/prompts/claude-design-finanzas.md`); el owner da acceso al
resultado por MCP y la spec se cierra con él.
