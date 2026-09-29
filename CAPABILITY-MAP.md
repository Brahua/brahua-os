# Mapa de capacidades: brahua-os

> Estado: **APROBADO** (2026-09-29)
> Índice de módulos del proyecto. Cada módulo tendrá su propio `SPEC-<id>.md`, que se escribe recién cuando le toque en el orden de construcción.

## Visión

brahua-os es mi "segundo cerebro" personal: una sola app (web responsive + PWA) para organizar hábitos, tareas y proyectos, finanzas, mascotas, metas y notas. Reemplaza al Second Brain de Notion y crece por módulos según lo vaya necesitando.

## Supuestos

1. **Un solo usuario (yo).** Hay login para proteger los datos, pero no hay modelo multi-usuario, ni roles, ni datos compartidos.
2. **Stack:** Next.js (App Router) + TypeScript + Postgres gestionado (Neon vía Vercel Marketplace), con despliegue en Vercel.
3. **Español** en la interfaz, los datos, la documentación y los commits. El código (identificadores) va en inglés, salvo los términos del dominio si se prefiere.
4. **Zona horaria y moneda:** `America/Lima` y **PEN**. Algunos pagos están en **USD**, así que los montos guardan su moneda.
5. **Migración única desde Notion** por módulo, con un script de importación que forma parte de la spec de cada módulo. Después, Notion queda solo como archivo.
6. **Mobile-first:** registrar un hábito o un gasto desde el celular debe tomar menos de 10 segundos. En Notion, el costo de registrar es la causa principal de abandono.
7. **Fuera del MVP:** colaboración, app nativa, IA y sincronización bidireccional con Notion. Se agregan como módulos futuros si hacen falta.

## Qué aprendimos de tu Notion

| Hallazgo | Implicación para brahua-os |
|---|---|
| Lo único vivo son los **Gastos recurrentes**. Hábitos, tareas y gastos diarios se abandonaron entre 2025 y 2026. | La prioridad es la **fricción de registro**: acciones de un toque y una vista "Hoy". |
| Los hábitos son **columnas** (un checkbox por hábito). | Los hábitos pasan a ser **filas** con registros, lo que permite rachas, cuotas semanales ("5/6", "2/3") y la meta de "90 días seguidos". |
| Hay 4 sistemas de hábitos, 4 de gastos y 3 de ejercicio duplicados. | **Una sola fuente de verdad** por entidad. Las "áreas de vida" son una clasificación transversal, no silos. |
| El estado Pagado/Pendiente se reinicia a mano y el vencimiento es un número suelto. | **Recurrencia real**: cada ciclo genera su ocurrencia, con avisos de vencimiento. |
| Las vacunas y desparasitaciones de las mascotas son texto ("mes"). | Se guardan **fechas reales** y a partir de ellas se generan recordatorios. |
| Las metas anuales, trimestrales y semanales no están conectadas ni tienen revisión. | Las metas se **enlazan** a hábitos y proyectos, con un ritual de revisión semanal. |
| Tareas del hogar, del trabajo y personales están mezcladas en una sola BD. | Tareas con **área de vida** y **proyecto**, y una bandeja de entrada para capturar rápido. |

## Módulos

| Id | Responsabilidad | Depende de |
|---|---|---|
| `nucleo` | Shell de la app, autenticación (1 usuario), PWA instalable, navegación, **áreas de vida**, sistema de diseño, convenciones para los módulos. | — |
| `habitos` | Hábitos como entidades, registro diario de un toque, frecuencias (diaria o X veces por semana), rachas, cumplimiento semanal, importación del Habit tracker. | nucleo |
| `proyectos` | Proyectos con estado (idea / activo / pausado / terminado), área de vida, objetivo, fechas, notas y enlaces; progreso calculado a partir de sus tareas. | nucleo |
| `tareas` | Tareas sueltas o dentro de un proyecto, bandeja de entrada, prioridad, fecha límite, recurrencia, área de vida, importación de Tareas del Hogar. | nucleo, proyectos |
| `hoy` | Tablero diario: hábitos de hoy, tareas que vencen y lo que cada módulo exponga como "resumen de hoy". | nucleo, habitos, tareas |
| `recordatorios` | Motor genérico de avisos (push de la PWA y/o email) al que los módulos le programan recordatorios. Incluye un cron diario. | nucleo |
| `finanzas` | Gastos, **pagos recurrentes** con ciclos y vencimientos, categorías, medios de pago, PEN/USD, resumen mensual, importación de Gastos. | nucleo, recordatorios |
| `metas` | Metas anuales y trimestrales y objetivo semanal, enlazadas a hábitos y proyectos, con revisión semanal guiada. | habitos, proyectos |
| `revision-semanal` | Ritual guiado para cerrar la semana (hábitos cumplidos, tareas, avance de proyectos y metas) y planear la siguiente con un objetivo semanal. | habitos, tareas, proyectos, metas |
| `aprendizaje` | Cursos, certificaciones y rutas de estudio (p. ej. AWS, Platzi, Career Roadmap) con avance, sesiones de estudio y enlace a metas. | nucleo, metas |
| `notas` | Daily log / journaling y notas de conocimiento con búsqueda. Es la parte de "segundo cerebro" propiamente dicha. | nucleo |

**Fuera de alcance:** mascotas (se construye como una app aparte).

## Más adelante

Ideas guardadas sin spec; se agregan al mapa cuando las pidas:

| Id | Idea |
|---|---|
| `salud` | Rutinas de ejercicio y registro de sesiones, terapia de rodilla, sueño y alimentación (unifica los 3 sistemas de ejercicio de Notion). |
| `biblioteca` | Libros, artículos y videos para leer o ver después. |
| `relaciones` | Cumpleaños, fechas importantes y recordatorio de contactar a familia y amigos. |
| `viajes` | Planes, itinerarios y presupuesto de viaje. |
| `presupuesto` | Tope mensual por categoría frente a gasto real (extiende `finanzas`). |
| `asistente-ia` | Asistente que consulta y resume tus datos de brahua-os. |

## Orden de construcción

```
nucleo → proyectos → tareas, habitos → hoy → recordatorios → finanzas → metas → revision-semanal → aprendizaje → notas
```

- El **MVP usable** llega al terminar `hoy`: ya puedo gestionar proyectos y registrar tareas y hábitos desde el celular a diario.
- `finanzas` va antes que `metas` porque es lo único que hoy usas activamente en Notion y te permitiría dejarlo antes.
- `hoy` se amplía en cada módulo nuevo: el módulo proveedor define su "resumen de hoy" y `hoy` lo consume.
