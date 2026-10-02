# Plan de implementación: projects

> Spec: [`SPEC-projects.md`](../SPEC-projects.md) (APROBADO v1, 2026-10-01) · Tareas: [`todo.md`](todo.md)
> Planes anteriores en [`archive/`](archive/) (`design-system`, `core`).

## Enfoque

Rebanadas verticales: cada tarea deja algo usable en producción (datos + acción + pantalla + pruebas). El flujo es el de `core`: implementador en un worktree → PR → revisores en paralelo (código, seguridad si toca datos o acciones, accesibilidad si toca UI) → correcciones → CI verde → merge → deploy y smoke test. E2E nativa por spec mientras se itera; capturas con `update-screenshots.yml`.

## Orden y dependencias

```
P1 datos + lista + crear ─┬─> P2 detalle y edición ─┬─> P3 hitos y avance
                          │                         ├─> P4 dependencias
                          │                         └─> P5 notas Markdown y enlaces
                          └─────────────────────────────> P6 contratos (tasks, today, export)
```

- **P1** es la base: esquema completo (las 4 tablas y sus `CHECK` en una sola migración aditiva), manifiesto disponible, lista agrupada con filtro por área y crear en un Sheet.
- **P2** construye el detalle (`/projects/[id]`) y la edición en el lugar; P3, P4 y P5 agregan secciones a esa página. Se pueden hacer **P3, P4 y P5 en paralelo** después de P2 (tocan secciones y archivos distintos; el detalle se compone de componentes por sección para evitar conflictos).
- **P6** es chico y puede ir en cualquier momento después de P1; se hace al final para no cambiar el contrato dos veces.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Conflictos al trabajar P3–P5 en paralelo sobre el detalle | P2 deja el detalle armado con una sección por componente y los puntos de inserción listos. |
| XSS por Markdown | `react-markdown` sin `rehype-raw`, con `rehype-sanitize`; pruebas con `<script>`, `javascript:` e imágenes con `onerror`. |
| Ciclos en dependencias con escrituras concurrentes | Comprobación recursiva dentro de una transacción con un lock por proyecto. |
| Fechas en hora de Lima (vencimiento) | Helpers puros en `progress.ts` con `src/lib/time.ts`, probados alrededor de la medianoche de Lima. |
| Reordenar hitos (arrastrar) es la parte más frágil (lo vimos en C6) | Reutilizar el patrón de C6 (`sortable-areas`, cola de guardado, foco) en vez de reescribirlo; extraer lo común si hace falta. |

## Checkpoints

- **Checkpoint P1:** el owner crea proyectos desde el celular y ve la lista agrupada.
- **Checkpoint final:** recorrido completo (crear, detalle, hitos, dependencias, notas, eliminar y deshacer) en celular y escritorio; criterios de éxito de la spec.
