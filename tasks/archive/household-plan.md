# Plan de implementación: household

> Spec: [`SPEC-household.md`](../../SPEC-household.md) (APROBADO v1.0, 2026-10-14) · Tareas: [`household-todo.md`](household-todo.md)
> Planes anteriores en [`archive/`](archive/). **Cerrado el 2026-10-14.**

## Enfoque

El de `weekly-review`: rebanadas verticales, **un implementador a la vez** (gate local liviano; los archivos de integración nuevos se corren de a uno), rama corta → PR a `main` → CI verde verificado antes de cada merge → deploy y smoke. Cada agente hace push **una vez**. Trabajo autónomo hasta el **Checkpoint final**; decisiones no cubiertas: la opción conservadora, anotada en HANDOFF como «decisión autónoma para revisar con el owner». **Presupuesto E2E:** un solo spec nuevo en todo el módulo (`household.spec.ts`, en H3), con su entrada en `SPEC_MODULES` y las etiquetas `@today-tasks`.

## Orden y dependencias

```
H1 Limpieza (contratos de tasks, vistas, alta) ─> H2 Compras (products) ─> H3 Recetas + E2E ─> H4 Cierre e importación
```

- **H1** no tiene tablas. Primero los contratos nuevos de `tasks` (`listTasksByTag`, `createTaskWithTags`, finalización reutilizando `completeTask`), luego `cleaning-*.ts` puros (frecuencia → recurrencia, zona, agrupar por zona y por día), la ruta `/household` con pestañas, el módulo en la navegación y la regla de ESLint. Deja los slots de las pestañas Compras y Recetas. Es la primera porque es la única que toca otro módulo y la que más riesgo trae (el vínculo por etiqueta tras la recurrencia).
- **H2** migración `household_products`, lock 7000, añadir con sugerencias, «Comprado», «Terminé la compra» y su «Deshacer» exacto.
- **H3** migración `household_recipes`, «Para hoy», filtros en la URL, hoja de alta/edición y el único E2E (cubre las tres pestañas).
- **H4** importación de las limpiezas desde Notion, retrospectiva, backlog, mapa, HANDOFF, archivo de plan y tareas, y Checkpoint.

H2 y H3 son independientes entre sí (tablas distintas), pero comparten la página y `module.ts`: se hacen en secuencia por la regla de un implementador a la vez.

## Riesgos

| Riesgo                                                                                             | Mitigación                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| La etiqueta es el único vínculo: si la recurrencia no copiara etiquetas, la limpieza saldría de la vista | Prueba de integración al inicio de H1: completar una limpieza y comprobar que la siguiente conserva `limpieza` y la zona. Si falla, se arregla en `tasks` antes de seguir. |
| Los contratos nuevos duplican algo que `tasks` ya tiene                                            | Primera subtarea de H1: leer `actions.ts`, `tasks.ts`, `tag-links.ts` y reutilizar; el contrato envuelve, no copia lógica.                                          |
| Semanal con varios días y quincenal/mensual dan fechas distintas a lo esperado                      | Tabla de casos unitaria del mapa frecuencia → recurrencia, con medianoche de Lima, cambio de mes y año.                                                             |
| Producto duplicado por dos añadidos a la vez                                                       | Lock `(7000, hashtext(name_key))` como primer lock + índice único parcial; prueba concurrente con control positivo.                                                  |
| «Terminé la compra» pisa un producto vuelto a marcar a mano                                        | «Deshacer» lleva ids y `bought_at`; escribe solo si siguen iguales.                                                                                                 |
| URL de receta maliciosa (`javascript:`)                                                            | Zod y `CHECK` solo `http(s)`; nunca se sigue desde el servidor; `rel="noopener noreferrer"`.                                                                        |
| La entrada nueva de navegación rompe E2E y capturas                                                | Se añade en H1; revisar `e2e/home.spec.ts` (cuenta enlaces) y dispatch de `update-screenshots.yml` justo tras el push.                                              |
| Tono de culpa en el copy («atrasada»)                                                              | Prueba automática de cadenas prohibidas sobre todo el copy de cada corte.                                                                                           |
| Presupuesto E2E y CI                                                                               | Un solo spec nuevo; el resto unitario, de componente o de integración.                                                                                              |

## Checkpoints

- **Tras H1:** la limpieza creada en Hogar aparece en Hoy y en `/tasks`; «Hecho» programa la siguiente con sus etiquetas.
- **Tras H3:** las tres pestañas funcionan y el E2E pasa en CI.
- **Checkpoint final:** recorrido del agente en producción con el Chrome personal del owner (datos `[QA]` que luego borra; las tareas de limpieza `[QA]` se eliminan por la app); el iPhone queda para el owner.
