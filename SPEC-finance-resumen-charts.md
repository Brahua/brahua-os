# Spec: finance-resumen-charts (dona por categoría y barras por medio de pago en «Resumen»)

> Extensión del módulo `finance` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `finance`, `finance-motion` y `finance-gastos` (en producción) · Estado: **APROBADO v1.0** (2026-10-16)
> Insumos: el diseño en Claude Design (proyecto `3787b11d-b9b0-4ea2-bd5d-26d0f072f863`, archivo `Finanzas.dc.html`: bloques «dona» y «medios») y las decisiones del owner del 2026-10-16 (abajo). Fuente de verdad visual: el diseño; este documento fija qué se construye y cómo se prueba.

## Objetivo

Que «Resumen» responda «¿en qué se me va el dinero?» de un vistazo: una **dona por categoría** (con el total o la categoría elegida al centro) y **barras por medio de pago**, en lugar de la barra apilada y de la lista compacta de medios de hoy. Los gráficos son una forma de leer los mismos números del resumen: no calculan dinero propio.

Decisiones del owner (2026-10-16):

- **Dona por categoría** y **barras horizontales por medio de pago**.
- La dona **reemplaza** a la barra apilada de 44 px (no conviven). La lista por categoría de debajo se conserva como leyenda pulsable.
- Los medios de pago son **solo de lectura** (no filtran «Gastos»); filtrar por medio queda para después (ya existe en el panel de filtros de «Gastos»).
- Los gráficos usan **solo el PEN convertido**; el USD sin convertir se muestra aparte y no suma a los totales ni a los porcentajes.
- **SVG propio, sin librerías** (decisión de `finance-motion`; `/finance` ya pesa +42 kB gz sobre su meta).

Fuera de este módulo: gráficos de otros meses o comparativos, un gráfico por día, exportar imágenes, filtrar por medio desde el gráfico, cambiar el cálculo del total o la conversión USD, tocar «Gastos» o «Recurrentes».

## Lo que el diseño propone (verificado contra el archivo)

- **Dona:** 176 px en escritorio y 208 px en móvil; anillo de 24/28 px de grosor; un hueco entre segmentos (`min(1/radio medio, ángulo/4)`); colores `--cat-1…8`; el anillo de fondo (`--div`) se ve cuando no hay datos.
- **Centro:** «Total del mes» + el monto + el nombre del mes; con un segmento bajo cursor, con foco o seleccionado, muestra **su nombre corto, su monto y su «% del mes»**. El texto se achica (15–17 px) si el monto es largo.
- **Segmento:** es un botón (`role="button"`, `aria-pressed`) con `aria-label` «Nombre: S/ monto, N % del mes». Seleccionado: crece 4 px hacia fuera y los demás bajan a 35 % de opacidad (200 ms). Foco por teclado: anillo de 2 px en `--focus`. Flechas ← → ↑ ↓ pasan de un segmento al siguiente (circular); Enter o espacio alterna el filtro.
- **Más de 8 categorías:** se muestran las 7 mayores y un segmento «Otros · N categorías» (con `--cat-8`); un toque en «Otros» filtra por **todas** las agrupadas.
- **Estados:** una sola categoría = anillo completo sin huecos; mes vacío = anillo de fondo y «Sin gastos» al centro; con USD sin convertir, una nota «+ US$ N sin convertir · no suma al total ni a los %».
- **Por medio de pago:** una fila por medio (nombre, monto en mono, % a la derecha) con una barra de 8 px bajo ella (ancho = % del total convertido, `--text` al 70 %); si hay USD sin convertir, una fila final «Sin convertir» con barra rayada y el detalle («Netflix · Crédito BCP» o «N gastos en dólares»).
- **Movimiento:** la dona se dibuja barriendo el ángulo (560 ms) y las barras crecen (900 ms con el escalonado del sistema); con movimiento reducido aparecen terminadas.

## Diferencias entre el diseño y la app real (decisiones que esta spec toma)

1. **Datos reales:** el diseño usa categorías fijas. La app las toma de `summarizeMonth(...).categories` (ya ordenadas por monto, con «Sin categoría» al final y `colorSlot`); los medios, de `summary.methods`. Los porcentajes son los de `summary.ts` (método del mayor resto: suman 100); el gráfico **no recalcula** ni redondea por su cuenta.
2. **Color:** cada segmento usa el `color_slot` de su categoría (`categoryStyle`); «Sin categoría» y «Otros» usan el slot 8. El color nunca es el único portador de información: nombre, monto y % están en la leyenda y en el `aria-label`.
3. **«Otros» filtra un conjunto:** el filtro de categorías de «Gastos» ya es un conjunto, así que «Otros · N» suma las N categorías agrupadas (no hay selección falsa).
4. **El filtro de la dona y el de «Gastos» son uno solo** (como hoy la barra apilada): tocar un segmento suma o quita su categoría y lleva a «Gastos»; el estado `aria-pressed` y la opacidad siguen los filtros activos.
5. **Medios de solo lectura:** las barras no son botones; la información está también como texto en cada fila.
6. **Motor de animación:** el trazo de la dona y el ancho de las barras se hacen con el contrato de movimiento existente (CSS puro para la entrada, `useValueTransition` para los cambios), sin `requestAnimationFrame` propio.

## Historias de usuario

1. Abro «Resumen» y veo en la dona qué categorías pesan más y cuánto llevo en total, sin leer la lista.
2. Paso el cursor, enfoco con el teclado o toco un segmento y el centro me dice cuánto es y qué parte del mes.
3. Toco un segmento y voy a «Gastos» filtrado por esa categoría; lo vuelvo a tocar y se quita.
4. Veo por medio de pago cuánto pasó por cada tarjeta o cuenta, con sus proporciones, y los dólares sin convertir aparte.
5. Con movimiento reducido, todo aparece terminado y la información es la misma.

## Datos

Sin tablas, columnas ni consultas nuevas. Todo sale del resumen que `MonthView` ya calcula sobre las filas del mes (`summary.categories`, `summary.methods`, `summary.total`).

- `donut-geometry.ts` (nuevo, puro): `donutSegments(groups, { size, thickness, gapPx })` → segmentos con su ángulo inicial y final, su trazo de sector (`path d`), su centro para etiquetas y `isFull`; agrupa en «Otros» con `groupOthers(groups, max = 8)`; mes vacío → sin segmentos. Mismo estilo de funciones puras que `chart-geometry.ts`.
- Reglas: segmentos con PEN ≤ 0 no se dibujan (solo USD sin convertir); el centro nunca divide por cero; los porcentajes vienen de `summary.ts`.

## Tech stack

Sin dependencias nuevas. SVG propio con `path` de sectores (como el diseño). **Presupuesto de JS:** el código nuevo debe pesar **≤ 5 kB gz** (se mide con dos builds, método de `CLAUDE.md`, «Measure the JS with two builds»); la dona y las barras se cargan con el resto de «Resumen» (no hay import dinámico: son pequeñas). No se añade ninguna librería de gráficos.

## Comandos

Los del repo: `nvm use`; `prettier --check`, `eslint`, `pnpm typecheck` y las unitarias tocadas (`rtk proxy pnpm vitest run --maxWorkers=2 <archivos>`); build solo para la medición de JS (excepción documentada). E2E, integración y capturas, solo en CI.

## Estructura del proyecto

- `src/modules/finance/donut-geometry.ts` (nuevo, puro) y sus pruebas.
- `src/modules/finance/components/category-donut.tsx` (nuevo: dona + centro + navegación por teclado; reemplaza a `stacked-bar.tsx`, que se elimina) y `method-bars.tsx` (nuevo: barras por medio; reemplaza a `MethodRows` en `month-summary.tsx`).
- Cambios en `month-view.tsx` (la dona en lugar de la barra apilada, «Otros» como conjunto), `month-summary.tsx` (`MixCard` usa las barras) y `summary-copy.ts` (copy).
- Estilos en `extensions.css` (nunca `tokens/` ni `components.css`).

## Estilo de código

Como el resto del módulo: comentarios en inglés explicando el porqué, copy en español en `summary-copy.ts`, centavos enteros, geometría pura y componentes que solo pintan; nada de números sueltos de tiempo (los de `SCREEN`).

## Estrategia de pruebas

- **Unitarias (grueso):** `donut-geometry` (ángulos que suman la vuelta completa, un solo segmento = anillo completo sin hueco, hueco proporcional, mes vacío, solo USD sin tasa, `groupOthers` con 8, 9 y 20 categorías, orden estable), y una prueba que compara los porcentajes del gráfico con los de `summarizeMonth`.
- **Componente:** la dona (segmentos como botones con `aria-pressed` y `aria-label`, flechas circulares, Enter y espacio alternan el filtro, el centro cambia con foco, cursor y selección y vuelve al total, «Otros» suma sus categorías al filtro, mes vacío, una categoría, movimiento reducido), las barras por medio (anchos, «Sin convertir» rayado, texto equivalente), y que tocar un segmento lleva a «Gastos».
- **E2E:** **ninguna nueva** (el presupuesto del repo es una por corte): se actualizan `e2e/finance-summary.spec.ts` y `e2e/finance-motion.spec.ts`, que hoy tocan la barra apilada.
- **Accesibilidad:** la dona es un grupo con nombre «Distribución por categoría»; cada segmento operable por teclado y con su descripción; axe en ambos temas (ya en las specs existentes); contraste AA del texto del centro; la leyenda conserva el dato como texto.
- **Capturas:** `update-screenshots.yml` justo después del push (las de «Resumen» cambian).

## Límites

- **Siempre:** los porcentajes y totales son los de `summary.ts`; USD sin convertir fuera de los gráficos y a la vista; foco restaurado y teclado completo; movimiento reducido respetado; el dato también como texto.
- **Preguntar primero:** añadir una librería de gráficos, volver pulsables los medios de pago, cambiar el cálculo de totales o la conversión USD, tocar otros módulos.
- **Nunca:** color como único portador de información, rojo/verde de juicio, montos reales en fixtures o capturas versionadas (el repo es público hasta ~2026-11-01), animar propiedades de layout costosas.

## Criterios de éxito

1. La dona dibuja una categoría por segmento con su color y el total al centro; sumar los ángulos da la vuelta completa y los porcentajes coinciden con los de `summarizeMonth` (prueba de comparación).
2. Cursor, foco o selección cambian el centro a la categoría (nombre, monto y % del mes) y al soltar vuelve al total.
3. Tocar un segmento (o Enter, espacio) alterna su categoría en el filtro de «Gastos» y lleva allí; «Otros · N» alterna las N agrupadas; `aria-pressed` y la opacidad siguen los filtros activos.
4. Con más de 8 categorías hay 7 segmentos y «Otros · N»; con una sola, anillo completo; sin PEN en el mes, anillo de fondo y «Sin gastos».
5. Las barras por medio muestran nombre, monto y % (los de `summary.ts`) y, si hay USD sin convertir, la fila «Sin convertir» aparte; no son pulsables.
6. Con movimiento reducido todo aparece terminado; nada se mueve ni cambia de opacidad con animación.
7. Todo es operable con teclado; axe sin violaciones nuevas en ambos temas; nada hace scroll lateral a 320 px (la dona de 208 px cabe).
8. El JS añadido a `/finance` ≤ **5 kB gz** (medido con dos builds antes y después).

## Plan de cortes (para aprobar; después `tasks/plan.md` y `tasks/todo.md`)

| Corte | Contenido | Datos | E2E |
|-------|-----------|-------|-----|
| **R1. Dona por categoría** | `donut-geometry.ts` y sus pruebas; `CategoryDonut` con centro, teclado, «Otros»; reemplaza `StackedBar` (se elimina) y ajusta `month-view.tsx`, la leyenda y las specs que tocaban la barra. | no | 0 nuevas |
| **R2. Barras por medio y cierre** | `MethodBars` (con «Sin convertir» rayado) en `MixCard`; copy; medición de JS (≤ 5 kB); capturas; docs (todo, HANDOFF, mapa). | no | 0 nuevas |

Orden: R1 → R2. Un PR por corte, un solo push por corte, gate local liviano, y revisión de accesibilidad en los dos.

## Preguntas abiertas

Ninguna (aprobado por el owner el 2026-10-16). Decisiones autónomas a revisar con el owner: «Otros · N» filtra todas las categorías agrupadas; el máximo de segmentos es 8 (7 + «Otros»); los porcentajes del gráfico son los de `summary.ts`, sin recalcular; el presupuesto de JS de 5 kB es una meta a medir, no un bloqueo.
