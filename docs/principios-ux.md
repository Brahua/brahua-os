# Principios de experiencia y diseño — brahua-os

> Documento transversal: aplica a todos los módulos del [mapa](../CAPABILITY-MAP.md). Cada `SPEC-<id>.md` debe indicar cómo cumple estos principios en sus pantallas.
> Estado: **BORRADOR — pendiente de aprobación**

## Por qué existe este documento

En Notion abandonaste hábitos, tareas y gastos diarios. **No fue falta de funciones: registrar costaba demasiado y no daba nada a cambio.** brahua-os tiene que conseguir que usarla sea rápido y agradable, y que dé ganas de volver. Por eso el diseño visual y la psicología del comportamiento son requisitos, no adornos.

## 1. Principios psicológicos → decisiones concretas

| # | Principio | Qué dice | Cómo lo aplicamos |
|---|---|---|---|
| 1 | **Modelo de Fogg (B = M·A·P)** | Una conducta ocurre cuando hay motivación, capacidad y un disparador en el mismo momento. | Bajar el esfuerzo al mínimo: marcar un hábito = **1 toque**, capturar una tarea o gasto = **< 10 s** desde cualquier pantalla. Los recordatorios son el disparador y llegan a la hora que tú elegiste. |
| 2 | **Bucle señal → rutina → recompensa** | Un hábito se refuerza si la recompensa es inmediata. | Cada acción completada tiene **feedback instantáneo**: micro-animación, vibración en Android y un número que sube animado. |
| 3 | **Efecto gradiente de meta** | Aceleramos el esfuerzo al acercarnos a la meta. | Anillos y barras de progreso visibles, con mensajes del tipo "te faltan 2 para cumplir tu semana". |
| 4 | **Progreso dotado** | Si ya empezaste, es más probable que termines. | La semana y los proyectos muestran lo que ya está hecho. Crear un proyecto con sus primeras tareas ya muestra avance. |
| 5 | **Efecto Zeigarnik** (con límite) | Lo inconcluso se queda en la mente. | "Hoy" muestra lo pendiente, pero **como máximo 3 prioridades** destacadas. El resto se pliega para no abrumar. |
| 6 | **Rachas con compasión** | Una racha rota provoca el efecto "ya da igual" y el abandono. | Hábitos con **cuota semanal** ("4 de 6") en vez de perfección diaria, regla de **"nunca falles dos veces"** y días de descanso. **Nunca** se castiga ni se pinta de rojo un día fallado. |
| 7 | **Efecto "nuevo comienzo"** | Los hitos temporales motivan a empezar de nuevo. | Lunes, inicio de mes y de trimestre abren la invitación a la **revisión semanal**, con el mensaje "semana nueva, pizarra limpia". |
| 8 | **Regla pico-final** | Recordamos una experiencia por su punto más intenso y por cómo terminó. | Una **pantalla de cierre del día** agradable cuando completas todo. La revisión semanal termina mostrando logros, no deudas. |
| 9 | **Autodeterminación** (autonomía, competencia, vínculo) | La motivación duradera es interna. | Autonomía: todo es configurable y no hay imposiciones. Competencia: el progreso es visible y acumulado. Vínculo: los hábitos se conectan con metas y con tu identidad. |
| 10 | **Hábitos basados en identidad** | "Soy alguien que lee" pesa más que "leer 15 minutos". | Cada hábito tiene una frase de identidad opcional. Los resúmenes muestran evidencia acumulada: "llevas 42 sesiones de lectura". |
| 11 | **Intenciones de implementación** | "Cuándo y dónde" duplica la probabilidad de cumplir. | Al crear un hábito se pide el momento ("después del desayuno") y la hora, y de ahí sale el recordatorio. |
| 12 | **Umbral de Doherty** | Si la respuesta tarda menos de 400 ms, la persona se mantiene en flujo. | **UI optimista**: la acción se refleja al instante y se sincroniza en segundo plano, con opción de deshacer. |
| 13 | **Ley de Hick y carga cognitiva** | Más opciones significan decisiones más lentas. | Una acción principal por pantalla. Divulgación progresiva: lo avanzado aparece solo al pedirlo. |
| 14 | **Ley de Fitts y zona del pulgar** | Los objetivos grandes y cercanos se alcanzan más rápido. | En el celular, las acciones principales van abajo y al alcance del pulgar: barra inferior, botón de captura y hojas inferiores (*bottom sheets*). Áreas táctiles de al menos 44 px. |
| 15 | **Recompensa variable** (con moderación) | Lo impredecible engancha. | Mensajes de celebración variados e hitos sorpresa (los 30 días de un hábito, un proyecto terminado). **Sin** puntos, loot ni mecánicas adictivas. |
| 16 | **Efecto estética-usabilidad** | Lo que es bello se percibe más fácil de usar y se perdona más. | Un pulido visual alto es un requisito, no un extra. |

### Lo que no haremos (patrones oscuros)

- No hay culpa ni vergüenza: nada de "¡fallaste!", rojo por incumplir ni rachas "perdidas" con dramatismo.
- No hay notificaciones insistentes ni manipuladoras. Cada aviso es útil y se puede configurar.
- No hay gamificación vacía (puntos, niveles o insignias sin sentido). La recompensa es **ver tu progreso real**.
- La interfaz no compite por tu atención: la app sirve a tu vida, no al revés.

## 2. Dirección visual

**Panel mono**, diseñada en Claude Design. La app se siente como un instrumento de hardware:
- Las acciones son teclas físicas que se hunden al presionarlas.
- Cada área de vida es un LED de color.
- Los mensajes de estado aparecen en una tira tipo pantalla LCD.
- Un único color de señal, naranja, marca "hoy" y "acción".
- La tipografía es Archivo, con IBM Plex Mono para datos y etiquetas.
- El modo oscuro va primero.

Los tokens, los componentes y las reglas concretas están en [`SPEC-design-system.md`](../SPEC-design-system.md), que prevalece sobre este documento en todo lo visual.

## 3. Movimiento y animación

**Regla de oro: toda animación comunica algo** (causa y efecto, jerarquía, continuidad o celebración). Si no comunica nada, se quita.

| Uso | Duración y curva |
|---|---|
| Feedback de toque (presionar, marcar) | 100–150 ms, spring rápido |
| Aparecer o desaparecer elementos, listas | 200–250 ms, `ease-out` o spring suave |
| Transiciones entre pantallas | 250–350 ms con View Transitions |
| Celebraciones (hábito, día o proyecto completado) | Hasta 800 ms, reservadas para momentos que lo merecen |

- Solo se animan `transform` y `opacity`, a 60 fps en un celular de gama media.
- Se respeta `prefers-reduced-motion`: las animaciones pasan a fundidos simples o se desactivan.
- Hay vibración con `navigator.vibrate` al completar algo en Android; en iOS se degrada sin problemas.

## 4. Librerías de UI y animación

| Librería | Para qué | Estado |
|---|---|---|
| **Motion** (`motion/react`) | Animaciones de layout, gestos (deslizar para completar), `AnimatePresence`, springs | Base de todo el movimiento |
| **React View Transitions** (`<ViewTransition>` de React 19.2 + `experimental.viewTransition` de Next.js) | Transiciones fluidas entre rutas y elementos compartidos | Navegación |
| **shadcn/ui** (Radix) + Tailwind v4 | Componentes accesibles y editables | Ya definido en `nucleo` |
| **Sonner** | Toasts con acción "Deshacer" | UI optimista (principio 12) |
| **Vaul** (Drawer de shadcn) | Hojas inferiores nativas en el celular | Captura rápida (principio 14) |
| **NumberFlow** (`@number-flow/react`) | Números que cambian animados (rachas, progreso, montos) | Recompensa (principios 2 y 3) |
| **canvas-confetti** | Celebraciones puntuales | Solo en hitos (principio 15) |
| **cmdk** | Paleta de comandos (`⌘K`) para capturar y buscar | Escritorio |
| **dnd-kit** | Reordenar áreas, tareas y hábitos | Interacción |
| **Recharts** (charts de shadcn) | Gráficos de progreso y finanzas | Estadísticas |

Las dependencias de cada módulo se agregan cuando ese módulo las necesita, no todas de golpe.

## 5. Criterios verificables

1. Marcar un hábito desde "Hoy": 1 toque, feedback visual en < 100 ms y el cambio persiste aunque la red sea lenta.
2. Capturar una tarea o un gasto desde cualquier pantalla del celular: ≤ 3 interacciones y < 10 s.
3. Ninguna pantalla muestra más de una acción primaria.
4. Con `prefers-reduced-motion: reduce` no hay animaciones de desplazamiento ni escala.
5. Lighthouse móvil: Accesibilidad ≥ 95, CLS < 0,1 e INP < 200 ms.
6. No hay ningún texto de culpa: revisión manual del copy en cada PR que toque la interfaz.
