# Prompt para Claude Design: rediseño de Finanzas (con movimiento)

Pegar en Claude Design con el sistema «brahua-os Design System» activo. Si se prefiere iterar por partes, usar primero
la sección «Pantalla» y luego «Movimiento».

---

Rediseña la pantalla **Finanzas** (`/finance`) de brahua-os usando el sistema de diseño existente (tokens, componentes
y tipografía actuales; tema oscuro por defecto, claro también). Es una app personal de una sola persona, en español
(Perú, soles), sobria y de datos. Entrega: escritorio (≥1024 px, contenido máx. 720–960 px) y móvil (375 px), ambos
temas, y para cada estado interactivo clave un frame de inicio y de fin del movimiento.

## Pantalla (vista «Mes»)

Orden de arriba abajo:

1. **Cabecera:** título «Finanzas», a la derecha «Registrar gasto» (botón primario) y «Ajustes». Pestañas **Mes · Pagos**
   con un indicador deslizante.
2. **Navegador de mes:** flechas + «Octubre 2026».
3. **Total del mes** grande (`S/ 3,682.62`, mono) con una línea de contexto neutra debajo: «+12 % vs. septiembre» y, en
   el mes en curso, «Día 14 de 31». Sin rojo/verde: es un dato, no un juicio (usar texto secundario; una flecha ↑/↓
   discreta como máximo).
4. **Dos tarjetas en fila:** *Gastado* (monto + mini línea de tendencia de 6 meses) y *Pendiente de pagar* (`S/ 5,017.18`,
   «8 pagos», próxima fecha), esta última navega a la pestaña Pagos.
5. **Gráfico de ritmo del mes:** área/línea del gasto acumulado por día, mes actual sólido y mes anterior como línea
   tenue; el día de hoy marcado; tooltip con día y monto al pasar el cursor o tocar.
6. **Desglose:** una **barra apilada segmentada** con las categorías (segmentos finos, separados por 2 px) y debajo la lista
   por categoría (nombre, monto, %). Tocar una categoría filtra la lista de gastos (se conserva ese comportamiento) y la
   barra apilada también es pulsable. A la derecha (escritorio) una sola tarjeta con **Por medio de pago** y
   **Recurrente / suelto**, de modo que ambas columnas queden de altura similar.
7. **Gastos del mes** agrupados por día: encabezado con el día y el **total del día**; filas con nombre, medio · categoría
   · «recurrente» en mono pequeño, y monto a la derecha (con «≈ S/» cuando es USD).

## Color (muy sutil)

Cada categoría tiene **un acento propio y discreto** que aparece solo como: punto de 8 px junto al nombre, segmento de la
barra apilada y una línea fina de 2 px al borde izquierdo de la fila filtrada. Nunca rellenar filas, tarjetas ni barras
completas. Paleta de ~8 tonos desaturados, distinguibles entre sí y con contraste correcto sobre fondo oscuro y claro, sin
rojo ni verde de «alerta/éxito» (esos significan otra cosa en la app). Todo dato debe leerse también sin color (nombre y
monto siempre presentes).

## Vista «Pagos» (solo ajustes de coherencia)

Pendientes arriba con botón «Pagado», «Este mes» debajo. Misma jerarquía y tarjetas que «Mes»; define el estado de la fila
al pagar.

## Movimiento (expresivo, pero con propósito)

Duraciones y curvas de los tokens existentes (`--duration-*`, `--ease-out`, `--ease-pop`, `--stagger: 24 ms`,
desplazamiento máx. 3–8 px). Solo `transform` y `opacity` cuando sea posible. Muestra inicio → fin de:

- **Entrada de la pantalla:** bloques aparecen en cascada (cabecera → total → tarjetas → gráfico → desglose → lista).
- **Cifras:** los números ruedan al cambiar (total, categorías, medios, pendiente, %).
- **Barras y gráfico:** la barra apilada se «despliega» segmento a segmento; la línea del gráfico se dibuja de izquierda a
  derecha; al cambiar de mes se interpolan al nuevo valor.
- **Cambio de mes:** el contenido sale y entra en la dirección de la flecha (±8 px + fade).
- **Pestañas Mes/Pagos:** el indicador se desliza y el contenido cruza.
- **Filtro por categoría:** las filas que no coinciden salen, el resto sube; aparece un chip «Quitar filtro» con rebote leve.
- **Registrar gasto:** la fila nueva entra desde arriba con un destello breve del acento de su categoría; al borrar,
  colapsa su altura y «Deshacer» la devuelve.
- **«Pagado»:** el check se dibuja, la fila viaja de Pendientes a «Este mes» y hay una celebración breve (≤1 s,
  `--duration-celebrate`), contenida: sin confeti de pantalla completa.
- **Reducción de movimiento:** versión estática de cada uno (solo fundidos de opacidad/color).

## Reglas

- Sin rojo ni tono de culpa; comparativos en neutro.
- Foco visible en todo control; objetivos táctiles ≥44 px en móvil; textos mono de metadatos ≥11 px con contraste AA.
- Nada de componentes nuevos si uno del sistema sirve; si hace falta uno (tarjeta de métrica, barra apilada, gráfico de
  área, chip de filtro), proponerlo como componente del sistema con sus estados y tokens.
- Mantén el copy en español, tuteo neutro y números con formato `S/ 1,234.56`.
