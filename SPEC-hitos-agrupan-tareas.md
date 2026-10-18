# Spec: hitos-agrupan-tareas (un hito es una fase que se completa con sus tareas)

> Cambio de modelo en `projects` y `tasks` (con efecto en `goals` y `weekly-review`) · Depende de `projects`, `tasks`, `goals` y `weekly-review` (en producción) · Estado: **BORRADOR v0.1** (2026-10-17; pendiente de aprobación del owner)
> Insumos: la conversación del 2026-10-17 (el owner vio que «hito» y «tarea» se solapan y eligió la opción 2) y el código actual: `projects/milestones.ts`, `projects/progress.ts`, `projects/progress-source.ts`, `tasks/progress-source.ts`, `tasks/milestone-data.ts`, `weekly-review/logros.ts`.

## Objetivo

Que haya **una sola cosa que se marca**: la tarea. Un hito deja de tener su propio checkbox y pasa a ser una **fase del proyecto** que agrupa tareas y **se completa sola** cuando todas sus tareas están hechas. El avance del proyecto (y el de las metas que lo siguen) cuenta **tareas**, no una mezcla de hitos y tareas de peso desigual.

Decisión del owner (2026-10-17): **opción 2** («hito = agrupador de tareas»). Las alternativas descartadas fueron dejarlo como está, quitar los hitos y contar solo tareas con los hitos informativos.

Fuera de este módulo: subtareas anidadas, dependencias entre tareas o entre hitos, hitos con porcentajes manuales, cambiar cómo se calcula «terminado» de un proyecto, tocar `habits`.

## Cómo es hoy (verificado en el código)

- `project_milestones` tiene `title`, `due_date`, `done_at` (el checkbox), `sort_order` y `deleted_at`.
- El avance de un proyecto suma **hitos hechos y total** más lo que registran las fuentes de avance (`combineProgressCounts`); `tasks` registra las suyas: tareas no eliminadas con `done_at` sobre el total. Cada unidad pesa igual: «Cirugía» pesa lo mismo que «comprar vendas».
- Una tarea puede apuntar a un hito (`tasks.milestone_id`) del mismo proyecto; la página del proyecto tiene dos secciones, «Hitos» y «Tareas» (agrupadas por hito).
- `weekly-review` cuenta «hitos cumplidos» de la semana por `done_at`; `goals` lee el avance del proyecto por su contrato.

## Diseño

### Estado derivado, nunca guardado

Un hito **no guarda** si está hecho: se **deriva al leer** de las tareas vivas (no eliminadas) que lo apuntan:

- `hechas` = tareas con `done_at`; `total` = todas.
- **Completo** = `total > 0` y `hechas = total`. **En curso** = `0 < hechas < total` o `total > 0` con alguna abierta. **Vacío** = `total = 0`: se muestra «Sin tareas» con una invitación a agregar la primera; no cuenta como hecho ni suma al avance.
- Su fecha de cierre = la mayor `done_at` de sus tareas cuando está completo.
- Al ser derivado **no hay lock ni escritura nueva**: completar, deshacer, borrar o restaurar una tarea ya lo cambia. Se acabó la carrera entre el checkbox del hito y sus tareas.

### Reglas

1. **El avance de un proyecto = tareas hechas / tareas** (sin los hitos como unidad). Sin tareas no hay avance (no se muestra 0 %), como hoy. Mantenimiento sigue sin avance.
2. **Un hito** muestra «N de M» y una barra pequeña; su título, su fecha y su orden se siguen editando; **eliminar un hito** (con «Deshacer») deja sus tareas en el proyecto, **sin hito** (como hoy).
3. **Tareas recurrentes y hitos:** una tarea con recurrencia **no puede pertenecer a un hito** (la siguiente ocurrencia reabriría la fase cada vez). Se valida en la acción y en el CHECK de la base; las existentes se sacan del hito al migrar (siguen en el proyecto).
4. **Fecha del hito:** se conserva como fecha objetivo de la fase; «Vencido» solo si no está completo.
5. **Un aviso al cerrar una fase:** al completar la **última** tarea abierta de un hito, el aviso de la tarea añade «Hito «X» completo» (una línea, sin confeti de pantalla completa; movimiento reducido respetado). «Deshacer» de la tarea lo reabre solo.
6. **«Marcar proyecto como terminado»** avisa de las **tareas** abiertas (ya lo hace) y de los hitos que quedan sin completar, nunca lo impide.
7. **Metas** (`goals`) que siguen un proyecto: su porcentaje es el del proyecto (ahora de tareas); «lograda» sigue siendo «proyecto terminado».

### Pantallas

- **Página del proyecto:** las dos secciones «Hitos» y «Tareas» se unen en **un solo «Plan»**: cada hito es un encabezado con «N de M», su barra, su fecha y sus acciones (editar, subir/bajar, arrastrar, eliminar); debajo, sus tareas con el agregar en línea; al final, «Sin hito». «Agregar hito» crea una fase vacía.
- **Tarjeta del proyecto y lista:** igual que hoy, con el avance de tareas; la «Siguiente acción» no cambia.
- **Revisión semanal (Logros):** «Hitos cumplidos» pasa a contar hitos cuya última tarea se cerró dentro de la semana y que están completos al leer.

### Datos y migración

- **Aditiva y reversible en lo posible:** `project_milestones.done_at` **se deja de escribir y de leer pero no se borra** (se quitará en un paso aparte con el visto bueno del owner y un respaldo, por la regla del repo: nada destructivo sin OK).
- **Migración de datos** (una vez, en una transacción, con id determinista, idempotente, y con respaldo verificado antes de correrla en producción):
  - Hito **sin tareas**: se crea **una tarea** con su título y su proyecto, apuntando al hito, hecha (`done_at` del hito) si el hito lo estaba, para no perder el avance ni el historial.
  - Hito **con tareas**: se descarta su `done_at` (su estado se deriva de las tareas); si estaba hecho con tareas abiertas, pasa a «en curso» (se avisa en el reporte de la migración).
  - Tareas **recurrentes** dentro de un hito: se les quita el hito.
  - El script imprime **cuentas y nombres, nunca montos ni contenido sensible** (reglas del repo), y se prueba contra una base de prueba.
- **Contratos:** `projects/progress.ts` pierde `countMilestones`/`milestoneProgress` por hitos; el contrato de avance se alimenta solo de las fuentes (tareas). `projects` sigue sin importar `tasks` (la fuente se registra como hoy); el estado derivado del hito lo calcula `tasks` (registra una fuente por hito) y `projects` lo pinta.

## Tech stack

Sin dependencias nuevas: Next 16, React 19, Drizzle/Postgres, `@dnd-kit` (ya instalado para reordenar hitos).

## Comandos

Los del repo: `nvm use`; `prettier --check`, `eslint`, `pnpm typecheck` y las unitarias tocadas; migración con `pnpm db:generate` + Prettier sobre el snapshot (el CHECK nuevo de recurrentes); una integración por archivo (`rtk proxy pnpm test:integration <archivo>`), incluida la de la migración de datos; el resto, en CI.

## Estructura del proyecto

- `src/modules/tasks/milestone-state.ts` (nuevo, puro): estado derivado de un hito (`complete`/`inProgress`/`empty`, conteos, fecha de cierre) y su prueba.
- `src/modules/tasks/progress-source.ts` (cambia): avance solo de tareas; `milestone-data.ts` lee los conteos por hito.
- `src/modules/projects/` : `milestones.ts` y `milestone-actions.ts` pierden el checkbox (`setMilestoneDone`); `progress.ts` y `contracts.ts` pasan a usar solo fuentes; copy en `milestones-copy.ts`.
- `src/app/(app)/projects/[id]/_components/`: `project-plan-section.tsx` une hitos y tareas; `milestone-rows.tsx` pinta el encabezado con su avance.
- `scripts/` : script de migración de datos (en español en sus mensajes, nombres en inglés) y su prueba.
- `src/modules/weekly-review/logros.ts` y su contrato de proyectos.

## Estilo de código

Como el resto: comentarios en inglés que explican el porqué, copy en español en `*-copy.ts`, funciones puras para el estado derivado, `ownerAction` en toda acción, borrado lógico con «Deshacer».

## Estrategia de pruebas

- **Unitarias (grueso):** `milestone-state.ts` (vacío, en curso, completo, una tarea eliminada o restaurada, fecha de cierre = última `done_at`), el avance de tareas con y sin hitos, validación de recurrentes sin hito, copy (sin cadenas de culpa).
- **Componente:** el encabezado del hito («N de M», barra, «Sin tareas»), el aviso «Hito completo» y su «Deshacer», eliminar un hito deja las tareas sin hito, el plan unido (orden, agregar en línea, foco restaurado).
- **Integración (una por archivo):** completar la última tarea completa el hito y deshacer lo reabre; eliminar y restaurar una tarea; recurrente rechazada en un hito (acción y CHECK, con control positivo); el avance del proyecto es de tareas; la **migración de datos** (hito vacío hecho y no hecho, hito con tareas, recurrente, idempotencia al correrla dos veces, nada se pierde); lo que lee `weekly-review`.
- **E2E:** **a lo sumo una** spec nueva: crear un hito, agregarle tareas, completarlas y ver «Hito completo»; axe en ambos temas y 320 px. Se **actualizan** `project-milestones.spec.ts` y `project-detail.spec.ts` (hoy marcan el checkbox del hito).
- **Accesibilidad:** el encabezado del hito con nombre, avance hablado («3 de 5 tareas»), sin depender del color; reordenar con teclado (Subir/Bajar) igual que hoy.

## Límites

- **Siempre:** el estado del hito se deriva (nunca se guarda ni se marca a mano); la migración se corre con respaldo verificado, en una transacción, con id determinista y sin imprimir datos sensibles; nada se borra físicamente; foco restaurado en lo que se desmonta; movimiento reducido respetado.
- **Preguntar primero:** quitar la columna `done_at` (destructivo), permitir recurrentes en hitos, cambiar el cálculo de «terminado» del proyecto.
- **Nunca:** que un hito reabra solo por una tarea recurrente, perder avance o historial al migrar, tono de culpa («atrasado», «fallaste») en los avisos.

## Criterios de éxito

1. Un hito se completa exactamente cuando todas sus tareas vivas están hechas (y tiene al menos una); completar o deshacer la última tarea lo cambia sin otra acción.
2. El avance del proyecto es tareas hechas / tareas; un proyecto con hitos pero sin tareas no muestra avance.
3. La página del proyecto tiene un solo «Plan»: cada hito con su «N de M» y su barra, sus tareas debajo y «Sin hito» al final; no hay checkbox de hito.
4. Eliminar un hito deja sus tareas en el proyecto y se puede deshacer; una tarea recurrente no puede ir en un hito.
5. Al completar la última tarea de un hito aparece «Hito «X» completo» una sola vez, y «Deshacer» lo revierte.
6. La migración conserva el avance de los proyectos existentes (los hitos vacíos hechos pasan a tareas hechas) y es idempotente; nada se pierde.
7. La revisión semanal cuenta como «hito cumplido» el que se completó esa semana; las metas de proyecto leen el avance de tareas.
8. Accesibilidad: axe sin violaciones nuevas en ambos temas; todo operable con teclado; nada hace scroll lateral a 320 px.

## Plan de cortes (para aprobar; después `tasks/plan.md` y `tasks/todo.md`)

| Corte | Contenido | Datos | E2E |
|-------|-----------|-------|-----|
| **H1. Estado derivado y avance de tareas** | `milestone-state.ts`; el avance del proyecto solo de tareas; la regla y el CHECK de recurrentes; la fuente de `tasks` por hito; el script de migración de datos (con su prueba) **sin correrlo aún**. | CHECK nuevo (aditivo) | 0 |
| **H2. Plan unificado y cierre de fase** | La página del proyecto con hitos como encabezados con avance, sin checkbox; «Hito completo» en el aviso de la tarea; «Terminar» avisa los hitos incompletos; `weekly-review` lee hitos derivados; se actualizan las E2E que marcaban el hito; **correr la migración en producción** (con respaldo y con el owner avisado) y verificarla. | corrida única de datos | 1 |
| **H3. Limpieza** (cuando el owner dé el visto bueno) | Quitar `done_at` de hitos y el código muerto; nueva migración destructiva con respaldo. | destructiva | 0 |

Orden: H1 → H2 → H3. Un PR por corte, un solo push, gate local liviano, revisión (`code-reviewer`, `security-auditor` solo para la migración) y accesibilidad en los de UI.

## Preguntas abiertas

1. **Hitos sin tareas:** ¿se permiten (se ven como «Sin tareas») o preferirías que un hito exija al menos una tarea al crearse? *Propuesta:* se permiten, como fase planeada que aún no tiene acciones.
2. **Migración de hitos vacíos hechos:** ¿se convierten en una tarea hecha (conserva el avance) o se descartan? *Propuesta:* tarea hecha con el mismo título.
3. **Recurrentes en hitos:** ¿se prohíben (propuesta) o se excluyen solo del cálculo del hito?
4. **Quitar `done_at`:** ¿lo dejamos para H3 con tu visto bueno? *Propuesta:* sí, en un paso aparte con respaldo.

Decisiones autónomas a revisar con el owner: el hito se completa solo con tareas vivas y sin recurrentes; el aviso «Hito completo» es una línea sin confeti de pantalla completa; el estado del hito se deriva siempre (sin escritura), incluida su fecha de cierre.
