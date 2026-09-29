# Mapa de capacidades: brahua-os

> Estado: **APROBADO** (2026-09-29)
> Índice de módulos del proyecto. Cada módulo tendrá su propio `SPEC-<id>.md` (ids en inglés; renombrados el 2026-09-29 antes de escribir código), que se escribe recién cuando le toque en el orden de construcción.

## Visión

brahua-os es mi "segundo cerebro" personal: una sola app (web responsive + PWA) para organizar hábitos, tareas y proyectos, finanzas, metas y notas. Reemplaza al Second Brain de Notion y crece por módulos según lo vaya necesitando.

## Supuestos

1. **Un solo usuario (yo).** Hay login para proteger los datos, pero no hay modelo multi-usuario, ni roles, ni datos compartidos.
2. **Stack:** Next.js (App Router) + TypeScript + Postgres gestionado (Neon vía Vercel Marketplace), con despliegue en Vercel.
3. **Idioma:** interfaz, specs y documentación en español. **Todo el código va en inglés** (identificadores, archivos, rutas, tablas, comentarios, ids de módulo y commits).
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
| `core` | Shell de la app, autenticación (1 usuario), PWA instalable, navegación, **áreas de vida**, sistema de diseño, convenciones para los módulos. | — |
| `habits` | Hábitos como entidades, registro diario de un toque, frecuencias (diaria o X veces por semana), rachas, cumplimiento semanal, importación del Habit tracker. | core |
| `projects` | Proyectos con estado (idea / activo / pausado / terminado), área de vida, objetivo, fechas, notas y enlaces; progreso calculado a partir de sus tareas. | core |
| `tasks` | Tareas sueltas o dentro de un proyecto, bandeja de entrada, prioridad, fecha límite, recurrencia, área de vida, importación de Tareas del Hogar. | core, projects |
| `today` | Tablero diario: hábitos de hoy, tareas que vencen y lo que cada módulo exponga como "resumen de hoy". | core, habits, tasks |
| `reminders` | Motor genérico de avisos (push de la PWA y/o email) al que los módulos le programan recordatorios. Incluye un cron diario y el service worker de la PWA (diferido desde `core`). | core |
| `finance` | Gastos, **pagos recurrentes** con ciclos y vencimientos, categorías, medios de pago, PEN/USD, resumen mensual, importación de Gastos. | core, reminders |
| `goals` | Metas anuales y trimestrales y objetivo semanal, enlazadas a hábitos y proyectos, con revisión semanal guiada. | habits, projects |
| `weekly-review` | Ritual guiado para cerrar la semana (hábitos cumplidos, tareas, avance de proyectos y metas) y planear la siguiente con un objetivo semanal. | habits, tasks, projects, goals |
| `learning` | Cursos, certificaciones y rutas de estudio (p. ej. AWS, Platzi, Career Roadmap) con avance, sesiones de estudio y enlace a metas. | core, goals |
| `notes` | Daily log / journaling y notas de conocimiento con búsqueda. Es la parte de "segundo cerebro" propiamente dicha. | core |

**Fuera de alcance:** mascotas (se construye como una app aparte).

## Más adelante

Ideas guardadas sin spec; se agregan al mapa cuando las pidas:

| Id | Idea |
|---|---|
| `health` | Rutinas de ejercicio y registro de sesiones, terapia de rodilla, sueño y alimentación (unifica los 3 sistemas de ejercicio de Notion). |
| `library` | Libros, artículos y videos para leer o ver después. |
| `relationships` | Cumpleaños, fechas importantes y recordatorio de contactar a familia y amigos. |
| `travel` | Planes, itinerarios y presupuesto de viaje. |
| `budget` | Tope mensual por categoría frente a gasto real (extiende `finance`). |
| `ai-assistant` | Asistente que consulta y resume tus datos de brahua-os. |

## Orden de construcción

```
core → projects → tasks, habits → today → reminders → finance → goals → weekly-review → learning → notes
```

- El **MVP usable** llega al terminar `today`: ya puedo gestionar proyectos y registrar tareas y hábitos desde el celular a diario.
- `finance` va antes que `goals` porque es lo único que hoy usas activamente en Notion y te permitiría dejarlo antes.
- `today` se amplía en cada módulo nuevo: el módulo proveedor define su "resumen de hoy" y `today` lo consume.
