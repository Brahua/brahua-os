# Plan de implementación: weekly-review

> Spec: [`SPEC-weekly-review.md`](../SPEC-weekly-review.md) (APROBADO v1.0, 2026-10-13) · Tareas: [`weekly-review-todo.md`](weekly-review-todo.md)
> Planes anteriores en [`archive/`](archive/). **Cerrado el 2026-10-14.**

## Enfoque

El de `goals`: rebanadas verticales, **un implementador a la vez** (gate local liviano; los archivos de integración nuevos se corren de a uno), rama corta → PR a `main` → CI verde verificado antes de cada merge → deploy y smoke. Cada agente hace push **una vez**. Trabajo autónomo hasta el **Checkpoint final**; decisiones no cubiertas: la opción conservadora, anotada en HANDOFF como «decisión autónoma para revisar con el owner». **Presupuesto E2E:** un solo spec nuevo en todo el módulo (W3), con su entrada en `SPEC_MODULES` y las etiquetas `@today-*` porque la tarjeta vive en `/`.

## Orden y dependencias

```
W1 contratos y datos ─> W2 pasos 1 y 2 ─> W3 pasos 3 y 4, cierre y registro ─> W4 invitación y cierre
```

- **W1** sin pantalla: migración `weekly_reviews`, `week.ts` puro, los cuatro contratos de lectura (`habits`, `tasks`, `projects`, `goals`), el lote de mover/deshacer de `tasks`, el contrato del objetivo semanal de `goals` y la regla de ESLint de fronteras. Deja los slots de los pasos.
- **W2** la ruta `/review`, el esqueleto de los 4 pasos, Logros y Pendientes, y el módulo en la navegación (cambia otras E2E y capturas: ver lecciones de `goals`).
- **W3** Metas y proyectos, Próxima semana, «Cerrar la semana», cierre y «Semanas anteriores». El único E2E.
- **W4** `getReviewInvite` y la tarjeta en `/` y `/goals` por la raíz de composición `src/lib/review-extensions.ts`; retrospectiva, backlog, mapa, HANDOFF y Checkpoint.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Semana por defecto y ventana de la invitación (domingo 18:00, lunes 23:59, medianoche de Lima) | `week.ts` puro con tablas de casos antes de la UI. |
| «Días completos» mal definido con pausas y días sin hábitos | Función pura reutilizando `streak.ts`/`schedule.ts`, con tabla de casos. |
| Mover en lote pisa una tarea editada mientras tanto | «Deshacer» y mover llevan id y fecha previa de cada tarea y escriben solo si la fila sigue igual. |
| Los proveedores acaban importando `weekly-review` | Contrato + raíz de composición + regla de ESLint; la tarjeta es la única cruza. |
| La tarjeta en `/` rompe E2E de Hoy y capturas | Etiquetas `@today-*`, `update-screenshots.yml` justo tras el push. |
| Tono de culpa en el copy | Prueba automática de cadenas prohibidas sobre todo el copy. |
| Presupuesto E2E y CI | Un solo spec nuevo; el resto unitario, de componente o de integración. |

## Checkpoints

- **Checkpoint final:** recorrido del agente en producción con el Chrome personal del owner (datos `[QA]` que luego borra); el iPhone queda para el owner.
