# Spec: today

> Módulo `today` del [mapa de capacidades](CAPABILITY-MAP.md) · Depende de `core`, `habits`, `tasks` (y lee `projects`) · Estado: **APROBADO v1** (2026-10-03).

## Objetivo

Que al abrir la app (`/`) sepa en un vistazo qué toca hoy y pueda hacerlo ahí mismo:

- **Hábitos de hoy** registrados con un toque, igual que en Hábitos.
- **Tareas retrasadas y de hoy**, completadas con un toque, sin abrumar: 3 destacadas y el resto plegado (principio 5).
- **Proyectos** que vencen en 7 días o están bloqueados, como recordatorio (solo enlaces).
- Un **cierre del día** agradable cuando no queda nada pendiente (principio 8).

Con `today` llega el **MVP usable** (`CAPABILITY-MAP.md`). El tablero no tiene datos propios: solo consume los contratos de los módulos proveedores (`getHabitsDueToday`, `getTasksTodaySummary`, `getProjectsTodaySummary`). Cada módulo nuevo (p. ej. `finance`, `reminders`) agregará su sección definiendo su contrato en su spec.

Fuera de este módulo: avisos y horarios (`reminders`), revisión semanal (`weekly-review`), metas (`goals`), editar o posponer tareas (se hace en su detalle), crear hábitos o proyectos (se hace en su módulo; la captura rápida global de `core`/`tasks` sigue disponible) y la navegación definitiva (diseño del owner en Claude Design).

### Historias de usuario

1. Abro la app en el celular a las 7:00: veo el saludo, la fecha y mis hábitos de hoy; toco "Meditar" y queda hecho, con "Deshacer".
2. Tengo 7 tareas para hoy y 2 retrasadas: veo las 3 primeras (las más retrasadas y de mayor prioridad) y "Ver 6 más"; completo una con su casilla y entra la siguiente.
3. Completo una tarea recurrente: queda hecha y el aviso dice cuándo es la siguiente, como en Tareas.
4. Un proyecto vence el viernes y otro está bloqueado: los veo al final como recordatorio y entro a cada uno con un toque.
5. A las 21:00 ya hice todo: arriba aparece "Día completo" con lo logrado hoy ("5 hábitos · 4 tareas").
6. Un día sin hábitos ni tareas: un estado vacío tranquilo, sin culpa, con enlaces a Hábitos y Tareas.

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Secciones y orden | Cabecera (fecha y saludo, la de hoy) → **Hábitos** → **Tareas** → **Proyectos**. Una sección sin elementos no se muestra (salvo el estado vacío del día). | Decisión del owner (2026-10-02). Lo diario y de un toque primero. |
| Hábitos | Los de `getHabitsDueToday(now)` (los que tocan hoy, no en pausa) como `HabitPad`, en el **orden manual**. Un pad hecho no cambia de lugar al tocarlo. Todos visibles (son compactos): el tope de 3 no aplica. | Decisión del owner (tope solo en tareas). Que no se muevan: **decisión para revisar con el owner** (un objetivo que salta bajo el dedo provoca toques errados). |
| Registrar hábitos | Igual que en Hábitos: un toque en sí/no, suma el paso en cantidad, recaída en "a evitar", "Ajustar" para el valor exacto, todo con "Deshacer". Reutiliza `HabitPad`, `useDayLog`/`useQuantityLog` y `HabitsScreenWithin` con los servicios de pantalla del anfitrión. | Decisión del owner. Una sola implementación (contrato H6). |
| Tareas | Las de `getTasksTodaySummary(now)` (retrasadas y de hoy, mismo orden que la vista Hoy de Tareas). Se ven las **3 primeras**; el resto se pliega tras "Ver N más" (despliega en la misma página; el estado plegado no se recuerda). | Decisión del owner (principio 5). |
| Completar tareas | Casilla en cada fila: completa con "Deshacer" (con la regla de recurrencia de T3: `completeTaskWithNext` y el aviso de la siguiente). La fila sale de la lista y, si había plegadas, sube la siguiente. El título enlaza a su página (`taskPath(id)`). Sin posponer ni editar desde aquí. | Decisión del owner. |
| Proyectos | Los de `getProjectsTodaySummary(now)`: nombre, área (LED), "Vence en N días" / "Vencido hace N días" y "Bloqueado por …". Solo lectura, cada fila enlaza a su proyecto. Sin tope (suelen ser pocos); **decisión para revisar con el owner** si crecen. | Decisión del owner (sección incluida). |
| Día completo | Cuando todos los hábitos de hoy están cumplidos (según la regla de `habits`) y no queda ninguna tarea retrasada ni de hoy, y **hubo algo** hoy (al menos un hábito o una tarea completada hoy), un bloque arriba del todo dice "Día completo" con un mensaje variado y lo logrado: hábitos cumplidos y tareas completadas hoy. Sin confeti ni pantalla aparte; aparece con un fundido (nada con movimiento reducido). Se anuncia una vez por el anunciador. | Decisión del owner (principio 8). El "hubo algo" evita celebrar un día vacío. |
| Día vacío | Sin hábitos que toquen hoy, sin tareas y sin proyectos: un mensaje tranquilo ("Nada programado para hoy") con enlaces a Hábitos y Tareas. | Principio 13; nunca culpa. |
| Hábitos "a evitar" y X por semana | Cuentan como cumplidos según `habits` (sin recaída hoy; o semana ya cumplida). | Una sola regla de cumplimiento (SPEC-habits). |
| Tareas completadas hoy | Nuevo contrato pequeño en `tasks`: `getTasksDoneTodayCount(now)` (tareas visibles con `done_at` en el día de Lima). Solo para "Día completo". | El resumen de T6 solo trae pendientes. |
| Revalidación | Las acciones de `tasks` y `projects` revalidan también `/` (hoy solo lo hace `habits` con `revalidateHabitScreens`). | Que el tablero no muestre datos viejos al volver. |
| Navegación | `today` toma `/`: el manifiesto "Hoy" pasa de `core` (`homeModule`) a `src/modules/today/module.ts` con el mismo id de navegación, atajo 1 y posición. La navegación definitiva (Hoy, Tareas, Hábitos) sigue esperando el diseño en Claude Design. | Sin cambio visible; el módulo dueño declara su ruta. |
| Hora y día | Todo con el día de Lima (`ownerDateKey`, `America/Lima`); el saludo y la fecha se calculan en el servidor, como la portada provisional. | Como los demás módulos. |
| Lecturas | La página hace las lecturas de los contratos **en paralelo** (`Promise.all`): número fijo de consultas (≤ 7: 3 de hábitos, 1 de tareas, 1 de completadas hoy, 2 de proyectos), sin N+1. | Rendimiento de la portada. |
| Copy | Nunca "fallaste", "atrasado" en rojo ni contadores de deuda. Las retrasadas y las de hoy usan el texto de `tasks` ("Retrasada hace N días", "Vence hoy") con el mismo color de señal que la vista Hoy de Tareas (naranja con LED), nunca rojo. | `docs/principios-ux.md`, "Lo que no haremos". |

## Pantalla

`/` (portada, `src/app/(app)/page.tsx`), una columna con `max-width` de contenido, en celular y escritorio:

1. **Cabecera:** fecha larga (etiqueta) y saludo (display), como hoy.
2. **Día completo** (condicional), o nada.
3. **Hábitos** — título de sección con "X de N" cumplidos; grilla de `HabitPad` (2 columnas en celular, más en escritorio, como Hábitos → Hoy); enlace "Ver hábitos" a `/habits`.
4. **Tareas** — título con el total ("Tareas · 9"); 3 filas (casilla, título, área, proyecto, "Retrasada hace N días" / "Vence hoy", marca de siguiente acción); "Ver 6 más" / "Ver menos"; enlace "Ver tareas".
5. **Proyectos** — filas compactas con LED de área, nombre, vencimiento y "Bloqueado por …".
6. **Día vacío** (condicional) en lugar de 3–5.

Una sola zona de avisos (la del anfitrión, `ScreenServicesProvider`) para hábitos y tareas. Ninguna acción primaria compite: la tecla de captura global sigue siendo la única acción destacada.

## Contratos

- **Consume:** `getHabitsDueToday(now)` + `HabitPad`/hooks (`@/modules/habits/contracts` y sus componentes cliente), `getTasksTodaySummary(now)` y `getTasksDoneTodayCount(now)` (`@/modules/tasks/contracts`, el segundo nuevo), `getProjectsTodaySummary(now)` (`@/modules/projects/contracts`). Si para "Día completo" hace falta saber si un `HabitItem` está cumplido hoy, `habits` exporta su función pura (no se reimplementa la regla).
- **Ofrece:** nada. `today` es una hoja: ningún módulo importa `@/modules/today` (regla nueva en `eslint.config.mjs`).
- **Ampliación futura:** cada módulo nuevo define en su spec su "resumen de hoy" y `today` agrega su sección. Un registro dinámico (como `registerProjectSection`) se decide cuando haya un cuarto proveedor, no antes.

## Comandos y estructura

Los mismos de `SPEC-core`. Módulo en `src/modules/today/`: `module.ts` (manifiesto "Hoy"), `today-board.ts` (puro: tope y plegado de tareas, "Día completo", conteos), `today-copy.ts` (mensajes, variantes de cierre), `components/` (`TodayBoard`, `TodayHabits`, `TodayTasks`, `TodayProjects`, `DayComplete`). Página en `src/app/(app)/page.tsx` (lee los contratos y pasa los datos). Lo nuevo de `tasks` en `src/modules/tasks/contracts.ts`.

## Estrategia de pruebas

| Nivel | Qué cubre |
|---|---|
| Unitarias | `today-board.ts` con tablas de casos (tope de 3, "Ver N más", día completo: todo hecho con actividad / todo hecho sin actividad / un hábito pendiente / una tarea pendiente / solo proyectos; día vacío); componentes (secciones ocultas sin elementos, plegado y foco al desplegar y al completar, anuncio único de "Día completo") |
| Integración | `getTasksDoneTodayCount` (día de Lima en la medianoche, tareas eliminadas y de proyectos eliminados fuera, autorización); la página lee los contratos con un número fijo de consultas |
| E2E | Registrar un hábito desde `/` y deshacer; completar una tarea y que suba la siguiente plegada; completar una recurrente (aviso de la siguiente); "Ver N más"; día completo al terminar lo último; día vacío; proyectos con enlace; axe en 0 en ambos temas y viewports (con `afterSaveSettled`); movimiento reducido; 320 px sin scroll horizontal; capturas con `expectScreenshot` |

## Límites

- **Siempre:** las de `SPEC-core`, `SPEC-projects`, `SPEC-tasks` y `SPEC-habits`, y las lecciones de `CLAUDE.md` (foco con `aria-disabled`, foco restaurado al completar una fila que desaparece, avisos que no tapan el control enfocado, hidratación antes de teclear en E2E, datos compartidos serializados).
- **Preguntar primero:** dependencias nuevas, tablas o migraciones (este módulo no debería necesitar ninguna), confeti.
- **Nunca:** que otro módulo importe `today`; reimplementar reglas de `habits` o `tasks` (cumplimiento, recurrencia, vencimiento) en `today`; texto de culpa o rojo.

## Criterios de éxito

1. **Un toque:** desde `/` en el celular, registrar un hábito y completar una tarea dan feedback en < 100 ms y quedan guardados en < 2 s, con "Deshacer".
2. **Contenido correcto:** hábitos que tocan hoy, tareas retrasadas y de hoy y proyectos que vencen o están bloqueados, por el día de Lima, en el orden de cada módulo.
3. **Sin abrumar:** como máximo 3 tareas visibles hasta "Ver N más".
4. **Cierre:** "Día completo" aparece al terminar lo último pendiente (con actividad hoy) y no aparece en un día vacío.
5. **Rendimiento:** número fijo de consultas en paralelo; la portada no empeora el LCP de la provisional (Lighthouse móvil: Accesibilidad ≥ 95, CLS < 0,1).
6. **Calidad:** CI en verde; axe en 0 en ambos temas; con `prefers-reduced-motion: reduce` no hay desplazamientos ni escalas; ningún texto de culpa.

## Plan (esbozo)

Cortes verticales; el detalle va en `tasks/plan.md` al aprobar la spec.

- **D1 — Tablero con hábitos:** módulo `today` (manifiesto, regla de límites), portada con cabecera, sección Hábitos con pads y registro, día vacío. Deja los slots de Tareas, Proyectos y Día completo.
- **D2 — Tareas:** sección Tareas con tope, plegado y completar (recurrencia incluida); `tasks` revalida `/`.
- **D3 — Proyectos:** sección Proyectos; `projects` revalida `/`.
- **D4 — Día completo:** `getTasksDoneTodayCount`, regla pura y bloque de cierre con copy variado.

D2 y D3 pueden ir en paralelo sobre los slots de D1 (cada uno con su `TEST_DB_PORT` y `E2E_PORT`); D4 necesita D2.

## Preguntas abiertas

Ninguna: las cuatro del borrador las respondió el owner (2026-10-02; spec aprobada el 2026-10-03: secciones Hábitos → Tareas → Proyectos; registrar hábitos y completar tareas; 3 tareas destacadas y el resto plegado; bloque de cierre en la página). Quedan las marcadas como **decisión para revisar con el owner**.
