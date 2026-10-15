# Spec: finance-gastos (filtros y paginación en «Gastos»)

> Extensión del módulo `finance` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `finance`, `finance-email` y `finance-motion` (en producción) · Estado: **APROBADO v1.0** (2026-10-15; las tres preguntas abiertas se resuelven con las propuestas por defecto)
> Insumos: decisiones del owner del 2026-10-15 (abajo) y la sección «Gastos» actual (`src/modules/finance/components/month-view.tsx`).

## Objetivo

Que el owner vea en «Gastos» **solo los gastos que quiere ver**, a su gusto, sin salir de la pantalla: filtrar por categoría, medio de pago, texto, monto, fechas, tipo y moneda; ordenar; y recorrer un mes largo **de a poco** en vez de una lista interminable. Los filtros son una **lente sobre la lista**: no cambian lo que el mes gastó.

Decisiones del owner (2026-10-15):

- Filtros: **categoría (varias)**, **medio de pago (varios)**, **texto en la descripción**, **rango de monto**, **rango de fechas dentro del mes**, **recurrente / suelto**, **moneda (PEN / USD)**.
- **Orden:** por fecha o por monto.
- **Paginación:** «Mostrar más» por días (se muestran los primeros 7 días con gastos; un botón trae 7 más). Accesible, simple y sin saltos de totales.
- **Alcance:** los filtros **solo filtran la lista**. El total del mes, el gráfico, el delta, la barra apilada y el resumen siguen siendo del mes completo.

Fuera de este módulo: guardar filtros con nombre, filtros que abarquen varios meses, exportar la selección, borrar o editar en lote, cambiar el cálculo del total o de la conversión USD, tocar «Resumen» (sus gráficos son otro spec).

## Lo que ya existe y se conserva

- La lista agrupada por día con el total del día, `ExpenseRow`, el borrado optimista con «Deshacer», la edición por hoja y el foco restaurado (`month-view.tsx`).
- El filtro por categoría desde «Resumen» (`StackedBar` y lista): sigue funcionando y **pasa a ser el filtro de categoría** del nuevo panel (una sola fuente de verdad). Tocar una categoría en Resumen la **suma** o **quita** de la selección y lleva a «Gastos».
- Las reglas de dinero: PEN convertido con la tasa guardada en cada gasto, USD sin tasa «sin convertir» aparte (`summary.ts`).

## Diseño de la pantalla

- Bajo el bloque «Por pagar» y sobre la lista: un **panel de filtros plegable** (cerrado por defecto) con un botón «Filtros» que muestra cuántos hay activos, y un selector de **orden** (Más recientes · Más antiguos · Mayor monto · Menor monto).
- Con filtros activos, una **fila de chips** (uno por filtro: «Casa», «Efectivo», «“café”», «S/ 20 – 100», «1–15 oct», «Recurrentes», «USD») cada uno con su «Quitar», y un «Quitar todos». Los chips usan el `FilterChip` existente (entra con `pop`, sale rápido).
- Encima de la lista, una **línea de resumen del filtro**: «12 gastos · S/ 1,240.00» (y «+ USD … sin convertir» si aplica), que cambia con los filtros. **El total grande del mes no cambia.**
- Sin resultados: un estado vacío con «Quitar filtros»; no ceros ni lista en blanco.
- Con la lista filtrada y ordenada por fecha, se conserva el agrupado por día con su total (el total del día es **el de los gastos mostrados** ese día, con el filtro). Ordenada por monto, la lista es **plana** (sin encabezados de día; cada fila muestra su fecha corta).
- Paginación: «Mostrar 7 días más» al final (con el contador «Mostrando 7 de 23 días»). En orden por monto, la unidad es **25 gastos**. El foco **se queda** en el botón y pasa a la primera fila nueva solo si el usuario usa teclado (el botón sigue existiendo mientras haya más).
- Todo el estado de filtros vive en el cliente de la pantalla (no en la URL ni en cookie); cambiar de mes **limpia** los filtros (decisión autónoma para revisar con el owner: igual que hoy el filtro de categoría).

## Datos

Sin tablas ni consultas nuevas: la página ya carga **todas las filas del mes** y el resumen se calcula sobre ellas en el cliente; los filtros, el orden y la paginación son **funciones puras** sobre esas filas (un mes de un solo usuario son cientos de filas como máximo). Si algún día un mes pasara de ~2 000 filas, la paginación pasaría al servidor (fuera de este spec, anotado en el backlog).

- `expense-filters.ts` (nuevo, puro): `ExpenseFilters` (categorías, medios, texto, montos mín. y máx. en centavos de PEN, desde/hasta día, tipo, moneda), `applyFilters`, `sortExpenses`, `paginate`, `summarizeSelection` (cuenta y suma en PEN con la misma conversión que `summary.ts`), `countActive`.
- Reglas: el texto busca en descripción **y** en nombre de categoría y de medio, sin distinguir mayúsculas ni tildes; el monto compara el **PEN convertido** (un USD sin tasa no entra en un rango de monto: solo se ve sin rango, y se dice); fechas inclusivas dentro del mes; categorías y medios son conjuntos (cualquiera de los elegidos), con «Sin categoría» / «Sin medio» elegibles.

## Estructura del proyecto

- `src/modules/finance/expense-filters.ts` (nuevo, puro) y su copy en `summary-copy.ts` (o `filters-copy.ts`).
- `src/modules/finance/components/expense-filters-panel.tsx` (panel plegable, campos, orden), `filter-chips.tsx` (la fila de chips sobre `FilterChip`), cambios en `month-view.tsx` (estado de filtros en vez del único `CategoryFilter`, línea de resumen del filtro, «Mostrar más»).
- Estilos en `extensions.css` (nunca `tokens/` ni `components.css`).

## Estilo de código

Como el resto del módulo: comentarios en inglés explicando el porqué, copy en español en archivos `*-copy.ts`, centavos enteros, funciones puras para todo lo que sea cálculo y componentes que solo pintan.

## Estrategia de pruebas

- **Unitarias (grueso):** `applyFilters` (cada filtro y su combinación, conjuntos vacíos, tildes y mayúsculas, USD sin tasa fuera del rango de monto, fechas inclusivas, «Sin categoría»), `sortExpenses` (estable, empates por fecha de creación), `paginate` (7 días, 25 gastos, último bloque, nada que mostrar), `summarizeSelection` (coincide con `summarizeMonth` cuando no hay filtros: prueba de comparación).
- **Componente:** el panel (abrir/cerrar, foco, campos con su error, `aria-expanded`), los chips (quitar devuelve el foco al botón «Filtros» o al siguiente chip), «Mostrar más» (foco y contador), el filtro de categoría desde «Resumen» (suma y quita), cambiar de mes limpia, borrado y «Deshacer» con filtros activos, estado vacío.
- **E2E:** **a lo sumo una** spec nueva (`e2e/finance-gastos.spec.ts`, con su entrada en `SPEC_MODULES`): filtrar por categoría y texto, ordenar por monto, «Mostrar más», quitar todos; axe en ambos temas y 320 px.
- **Accesibilidad:** panel con `aria-expanded` y `aria-controls`, grupos con `fieldset` y `legend`, resultados anunciados una vez («12 gastos, S/ 1,240.00») sin repetir en cada tecla, todo operable con teclado, contraste AA.

## Límites

- **Siempre:** el total del mes, el gráfico y el delta **no** dependen de los filtros; el filtro de categoría de «Resumen» y el del panel son el mismo; foco restaurado en todo lo que se desmonta; sin `setTimeout` sin limpieza; el campo de texto con retardo de entrada de 250 ms y limpieza al desmontar.
- **Preguntar primero:** mover la paginación al servidor, guardar filtros (cookie, URL o base de datos), tocar el cálculo de totales o la conversión USD, filtros de varios meses.
- **Nunca:** que un filtro oculte un gasto del total del mes; mostrar montos reales en fixtures o capturas versionadas (el repo es público hasta ~2026-11-01); bloquear la interacción mientras se filtra.

## Criterios de éxito

1. Cada filtro (y sus combinaciones) deja en la lista exactamente los gastos que cumplen, y la línea «N gastos · S/ …» coincide con la suma de lo mostrado (prueba de comparación con `summarizeMonth` sin filtros).
2. El total del mes, el gráfico, la barra apilada y el delta **no cambian** al filtrar.
3. «Mostrar 7 días más» muestra los 7 días siguientes con gastos y desaparece cuando no queda nada; con filtros, cuenta sobre lo filtrado.
4. El orden por monto da una lista plana; el orden por fecha conserva el agrupado por día y su total.
5. Borrar, editar y «Deshacer» siguen funcionando igual con filtros activos (mismas pruebas verdes) y el foco nunca se pierde.
6. Todo es operable con teclado y anunciado una sola vez; axe sin violaciones nuevas; nada hace scroll lateral a 320 px.
7. Un mes con cientos de gastos filtra y ordena sin retrasos perceptibles (< 50 ms medidos en una prueba con 1 000 filas).

## Plan de cortes (para aprobar; después `tasks/plan.md` y `tasks/todo.md`)

| Corte | Contenido | E2E |
|-------|-----------|-----|
| **G1. Motor puro y panel** | `expense-filters.ts` con sus pruebas; panel plegable con categoría, medio, texto y orden; chips; línea de resumen del filtro; el filtro de categoría de «Resumen» pasa a ser el del panel. | 0 |
| **G2. Resto de filtros y paginación** | Monto, fechas, tipo y moneda; «Mostrar más» por días (y de a 25 en orden por monto); estado vacío; cierre con la spec E2E y capturas. | 1 |

Orden: G1 → G2. Un PR por corte, un solo push, gate liviano local, revisión (`code-reviewer`, `test-engineer`; accesibilidad en UI).

## Preguntas abiertas

1. ¿Los filtros se **recuerdan** al volver a «Gastos» dentro de la misma sesión (sí, mientras no se cambie de mes) o también entre sesiones? *Propuesta:* solo dentro de la sesión, sin cookie.
2. ¿El orden por monto debe incluir los USD sin tasa (sin valor en PEN)? *Propuesta:* al final, marcados «sin convertir».
3. ¿Quieres un acceso rápido «Solo este mes recurrentes» (atajo del filtro tipo)? *Propuesta:* no; el filtro de tipo ya lo cubre.

Decisiones autónomas a revisar con el owner: el estado de filtros no va en la URL; cambiar de mes limpia los filtros; el orden por monto da una lista plana.
